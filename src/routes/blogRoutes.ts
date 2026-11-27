import { Router } from 'express';
import {
  listPosts, getPost, countView, createPost, updatePost,
  getMyPosts, deletePost, adminListPosts, reviewPost,
} from '../controllers/blogController';
import { verifyToken } from '../middleware/authMiddleware';
import { verifyAdmin } from '../middleware/adminAuth';

const router = Router();

// Fixed paths MUST come before '/:id'
router.get('/', listPosts); // 🌍
router.get('/post/:slug', getPost); // 🌍
router.get('/mine', verifyToken, getMyPosts); // 🔒 author
router.get('/admin/all', verifyToken, verifyAdmin, adminListPosts); // 🔒 admin

router.post('/', verifyToken, createPost); // 🔒 teacher or admin
router.post('/:id/view', countView); // 🌍
router.patch('/:id/review', verifyToken, verifyAdmin, reviewPost); // 🔒 admin
router.patch('/:id', verifyToken, updatePost); // 🔒 author
router.delete('/:id', verifyToken, deletePost); // 🔒 author or admin

export default router;
