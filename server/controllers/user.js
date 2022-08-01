import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import lodash from 'lodash'
import User from '../models/user.js'
import PostMessage from '../models/postMessage.js'
import crypto from 'crypto'
import { sendEmail } from '../utils/emailSender.js'

const secret = 'test'
const regex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
const countOccurrences = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0)
const getTop5Tags = ({ allTags: tags }) => {
	let frequency = {}
	tags.map((tag) => (frequency[tag] = countOccurrences(tags, tag)))
	tags.sort((self, other) => {
		let diff = frequency[other] - frequency[self]
		if (diff == 0) diff = frequency[other] - frequency[self]
		return diff
	})
	return [...new Set(tags)].splice(0, 5)
}

export const signin = async (req, res) => {
	const { email, password, remember } = req.body

	try {
		const existingUser = await User.findOne({ email })

		if (!existingUser) {
			return res.status(404).json({ message: "User doesn't exist in dataBase" })
		}
		const isPasswordCorrect = await bcrypt.compare(password, existingUser.password)

		if (!isPasswordCorrect) {
			return res.status(401).json({ message: 'Invalid credentials' })
		}

		const token = jwt.sign({ email: existingUser.email, id: existingUser._id }, secret, remember ? null : { expiresIn: '1h' })

		res.status(200).json({ result: existingUser, token })
	} catch (error) {
		res.status(500).json({ message: 'Something went wrong' })
	}
}

export const signup = async (req, res) => {
	const { email, password, confirmPassword, firstName, lastName, avatar } = req.body

	try {
		const existingUser = await User.findOne({ email })
		if (existingUser) {
			return res.status(409).json({ message: 'User already exists' })
		}
		if (!email.match(regex)) {
			return res.status(501).json({ message: 'Invalid Email ID' })
		}
		if (password !== confirmPassword) {
			return res.status(409).json({ message: "Passwords don't match" })
		}
		if (password.length < 6) {
			return res.status(409).json({ message: 'Password length must be greater than 6 characters' })
		}

		const hashedPassword = await bcrypt.hash(password, 12)
		const result = await User.create({ email, password: hashedPassword, name: `${firstName} ${lastName}`, avatar: avatar })
		const token = jwt.sign({ email: result.email, id: result._id }, secret, { expiresIn: '1h' })

		res.status(201).json({ result, token })
	} catch (error) {
		res.status(500).json({ message: 'Something went wrong' })
	}
}

export const updateDetails = async (req, res) => {
	const { firstName, lastName, avatar, email, id, prevPassword, newPassword } = req.body

	try {
		const { name, email: oldEmail, avatar: oldAvatar, password } = await User.findById(id)
		// Check for same existing data posted
		const newPasswordsSame = await bcrypt.compare(newPassword || '', password)
		const oldPasswordsDifferent = !(await bcrypt.compare(prevPassword, password))
		const sameData =
			name.split(' ')[0] === firstName && //
			name.split(' ')[1] === lastName &&
			oldEmail === email &&
			(!newPassword || newPasswordsSame) &&
			lodash.isEqual(oldAvatar, avatar)
		if (sameData) {
			return res.status(409).json({ message: `No new updates were applied` })
		}
		if (!email.match(regex)) {
			return res.status(501).json({ message: 'Invalid Email ID' })
		}
		if (oldPasswordsDifferent) {
			return res.status(409).json({ message: 'Incorrect Previous Password' })
		}
		if (newPassword && newPassword.length < 6) {
			return res.status(409).json({ message: 'Password length must be greater than 6 characters' })
		}
		const user = {
			name: `${firstName} ${lastName}`,
			email: email,
			password: newPassword ? await bcrypt.hash(newPassword, 12) : password,
			avatar: avatar,
		}
		await User.findByIdAndUpdate(id, { ...user, id }, { new: true })
		res.status(204).json({ message: 'User Updated Successfully' })
	} catch (error) {
		res.status(500).json({ message: 'Something went wrong.' })
	}
}
export const getUserDetails = async (req, res) => {
	const { id } = req.params

	try {
		const allTags = await PostMessage.aggregate([
			{ $match: { creator: id } },
			{
				$group: {
					_id: null,
					tags: { $push: '$tags' },
				},
			},
			{
				$project: {
					_id: 0,
					allTags: {
						$reduce: {
							input: '$tags',
							initialValue: [],
							in: {
								$concatArrays: ['$$this', '$$value'],
							},
						},
					},
				},
			},
		])
		const longestPost = (
			await PostMessage.aggregate([
				{ $match: { creator: id } },
				{
					$project: {
						message: 1,
						messageLength: { $strLenCP: '$message' },
					},
				},
				{ $sort: { messageLength: -1 } },
			])
		)[0]

		const result = {
			postsCreated: await PostMessage.countDocuments({ creator: id }),
			postsLiked: await PostMessage.countDocuments({ likes: { $all: [id] } }),
			privatePosts: await PostMessage.countDocuments({
				$and: [{ creator: id }, { _private: true }],
			}),
			totalLikesRecieved:
				(
					await PostMessage.aggregate([
						{ $match: { creator: id } },
						{
							$group: {
								_id: '_id',
								totalValue: {
									$sum: {
										$size: '$likes',
									},
								},
							},
						},
					])
				)[0]?.totalValue || 0,
			longestPostWords: longestPost?.message.split(' ').length || 0,
			top5Tags: allTags.length ? getTop5Tags(allTags[0]) : allTags,
			longestPostId: longestPost?._id,
		}
		res.status(200).json(result)
	} catch (error) {
		res.status(404).json({ message: error.message })
	}
}

export const getUserPostsByType = async (req, res) => {
	const { id } = req.params
	const { page, type } = req.query

	try {
		const query = {
			created: { creator: id },
			liked: { likes: { $all: [id] } },
			private: { $and: [{ creator: id }, { _private: true }] },
		}

		const LIMIT = 10
		const total = await PostMessage.countDocuments(query[type])
		const startIndex = (Number(page) - 1) * LIMIT
		const posts = await PostMessage.find(query[type]).limit(LIMIT).sort({ createdAt: -1 }).skip(startIndex)

		res.status(200).json({ data: posts, numberOfPages: Math.ceil(total / LIMIT) })
	} catch (error) {
		res.status(404).json({ message: error.message })
	}
}

export const forgotPassword = async (req, res) => {
	const { email } = req.body
	try {
		const existingUser = await User.findOne({ email })
		if (!existingUser) {
			return res.status(404).json({ message: "User doesn't exist in dataBase" })
		}
		if (existingUser.resetToken) {
			return res.status(409).json({ message: 'Reset Link already sent. Please check your email' })
		}

		const { id } = existingUser
		const token = crypto.randomBytes(32).toString('hex')
		const URL = `${process.env.BASE_URL}/auth/forgotPassword/${id}/${token}`
		existingUser.resetToken = token
		await User.findByIdAndUpdate(id, { ...existingUser, id }, { new: true })

		sendEmail(email, URL, res)
	} catch (error) {
		res.status(500).json({ message: error.message })
	}
}

export const resetPassword = async (req, res) => {
	const { id, token, newPassword } = req.body
	try {
		const existingUser = await User.findById(id)

		if (!existingUser || !token || token !== existingUser.resetToken) {
			return res.status(404).json({ message: 'Invalid URL. Please try again' })
		}
		if (newPassword.length < 6) {
			return res.status(409).json({ message: 'Password length must be greater than 6 characters' })
		}
		const passwordsSame = await bcrypt.compare(newPassword, existingUser.password)
		if (passwordsSame) {
			return res.status(406).json({ message: "New password can't be same as old password" })
		}

		const hashedPassword = await bcrypt.hash(newPassword, 12)

		existingUser.password = hashedPassword
		existingUser.resetToken = null

		await User.findByIdAndUpdate(id, { ...existingUser, id }, { new: true })
		res.status(200).json()
	} catch (error) {
		res.status(500).json({ message: error.message })
	}
}
