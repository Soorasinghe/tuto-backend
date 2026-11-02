import { Router } from 'express';
import {
  listPapers,
  downloadPaper,
  createPaper,
  getMyPapers,
  deletePaper,
  adminListPapers,
  reviewPaper,
} from '../controllers/paperController';
import { verifyToken } from '../middleware/authMiddleware';
import { verifyAdmin } from '../middleware/adminAuth';

const router = Router();

// Fixed paths MUST come before '/:id'
router.get('/', listPapers); // 🌍
router.get('/mine', verifyToken, getMyPapers); // 🔒 teacher
router.get('/admin/all', verifyToken, verifyAdmin, adminListPapers); // 🔒 admin

router.post('/', verifyToken, createPaper); // 🔒 teacher or admin
router.post('/:id/download', downloadPaper); // 🌍 counts + returns link
router.patch('/:id/review', verifyToken, verifyAdmin, reviewPaper); // 🔒 admin
router.delete('/:id', verifyToken, deletePaper); // 🔒 owner or admin

export default router;
