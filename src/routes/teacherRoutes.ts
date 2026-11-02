import { Router } from 'express';
import {
  unlockContact,
  updateProfile,
  getTeacher,
  getTeacherLeads,
  syncTeacherProfile,
  getMyProfile,
} from '../controllers/teacherController';
import { getLocations } from '../controllers/locationController';
import { verifyToken, requireSelf } from '../middleware/authMiddleware';

const router = Router();

// 🔒 Creates the Firestore profile on first login (replaces the old public /register)
router.post('/sync', verifyToken, syncTeacherProfile);

// 🔒 The logged-in teacher's own full profile. MUST be declared before '/:teacherId'.
router.get('/me', verifyToken, getMyProfile);

// 🌍 Public: needed for search dropdowns. MUST be declared before '/:teacherId'.
router.get('/locations', getLocations);

// 🌍 Public: anyone can view a profile (public fields only)
router.get('/:teacherId', getTeacher);

// 🔒 Only the teacher themselves can see their leads / edit their profile
router.get('/:teacherId/leads', verifyToken, requireSelf, getTeacherLeads);
router.patch('/:teacherId/profile', verifyToken, requireSelf, updateProfile);

// 🌍 Public, but rate-limited inside the controller
router.post('/:teacherId/unlock', unlockContact);

export default router;
