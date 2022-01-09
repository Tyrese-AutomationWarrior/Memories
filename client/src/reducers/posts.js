import { FETCH_ALL, CREATE, UPDATE, DELETE } from "../constants/actionTypes";
export default (posts = [], action) => {
	switch (action.type) {
		case FETCH_ALL:
			return action.payload;
		case CREATE:
			return [...posts, action.payload];
		case DELETE:
			return posts.filter((post) => post._id !== action.payload._id ? action.payload : post);
		case UPDATE:
			return posts.map((post) => post._id === action.payload._id ? action.payload : post);
		default:
			return posts;
	}
};
