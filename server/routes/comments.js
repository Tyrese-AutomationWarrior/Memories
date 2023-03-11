import express from 'express'
import { createComment, deleteComment, getComments } from '../controllers/comments.js'
import auth from '../middleware/auth.js'

const router = express.Router()

router.get('/:id', auth, getComments)
router.post('/', auth, createComment)
router.delete('/:id', auth, deleteComment)

export default router
