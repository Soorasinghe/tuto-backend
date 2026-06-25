import { Router } from 'express';
import { createAd, getAllAds, getActiveAd } from '../controllers/adController';
import { verifyToken } from '../middleware/authMiddleware';
import { verifyAdmin } from '../middleware/adminAuth';

const router = Router();

// 🌍 Public route for the homepage
router.get('/active', getActiveAd);

// 🔒 Double Protected: Admin routes
router.get('/all', verifyToken, verifyAdmin, getAllAds);
router.post('/create', verifyToken, verifyAdmin, createAd);

export default router;