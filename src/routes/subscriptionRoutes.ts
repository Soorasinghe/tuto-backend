import { Router } from 'express';
import { 
  submitManualPayment, 
  getPendingSubscriptions, 
  approveSubscription, 
  rejectSubscription 
} from '../controllers/subscriptionController';
import { verifyToken } from '../middleware/authMiddleware';
import { verifyAdmin } from '../middleware/adminAuth';

const router = Router();

// Protected Teacher Routes
router.post('/submit', verifyToken, submitManualPayment);

// Protected Admin Routes
router.get('/pending', verifyToken, verifyAdmin, getPendingSubscriptions);
router.patch('/approve/:id', verifyToken, verifyAdmin, approveSubscription);
router.patch('/reject/:id', verifyToken, verifyAdmin, rejectSubscription); // 🔥 NEW

export default router;