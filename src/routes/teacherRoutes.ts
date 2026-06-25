import { Router } from 'express';
import { 
  registerTeacher, 
  unlockContact, 
  updateProfile, 
  getTeacher, 
  getTeacherLeads 
} from '../controllers/teacherController';
import { getLocations } from '../controllers/locationController';
import { verifyToken } from '../middleware/authMiddleware';

const router = Router();

console.log('🛣️  Teacher routes loaded into memory!');

// 🔒 Protected: Must be logged in to register
router.post('/register', verifyToken, registerTeacher);

// 🌍 Public: Needed for search dropdowns
router.get('/locations', getLocations);

// 🌍 Public: Anyone can view a profile
router.get('/:teacherId', getTeacher);

// 🔒 Protected: Only logged-in teachers can see their own leads
router.get('/:teacherId/leads', verifyToken, getTeacherLeads);

// 🔒 Protected: Only logged-in teachers can update their profile
router.patch('/:teacherId/profile', verifyToken, updateProfile);

// 🌍 Public: Students don't need an account to unlock contacts right now
router.post('/:teacherId/unlock', unlockContact);

export default router;