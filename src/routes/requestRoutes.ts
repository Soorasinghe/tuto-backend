import { Router } from 'express';
import {
  listRequests,
  getRequest,
  createRequest,
  closeRequest,
  contactRequest,
  adminListRequests,
  removeRequest,
} from '../controllers/requestController';
import { verifyToken } from '../middleware/authMiddleware';
import { verifyAdmin } from '../middleware/adminAuth';

const router = Router();

// Fixed paths MUST come before '/:id'
router.get('/', listRequests); // 🌍
router.get('/admin/all', verifyToken, verifyAdmin, adminListRequests); // 🔒 admin
router.post('/', createRequest); // 🌍 rate-limited

router.get('/:id', getRequest); // 🌍
router.patch('/:id/close', closeRequest); // 🌍 needs the poster's manage key
router.post('/:id/contact', verifyToken, contactRequest); // 🔒 verified paid teacher
router.patch('/:id/remove', verifyToken, verifyAdmin, removeRequest); // 🔒 admin

export default router;
