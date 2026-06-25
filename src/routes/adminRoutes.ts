import { Router } from 'express';
import { getAdminStats, getPendingTeachers, approveTeacher, getAllTeachersForAdmin, updateTeacherStatusManually } from '../controllers/adminController';
// 🔥 Import the reject function from the teacher controller
import { rejectTeacher } from '../controllers/teacherController';
import { verifyToken } from '../middleware/authMiddleware';
import { verifyAdmin } from '../middleware/adminAuth'; 

const router = Router();

// 🔒 Double Protected: Must be logged in AND be Admin
router.get('/stats', verifyToken, verifyAdmin, getAdminStats);
router.get('/pending', verifyToken, verifyAdmin, getPendingTeachers);
router.patch('/approve/:id', verifyToken, verifyAdmin, approveTeacher);
router.get('/teachers', verifyToken, verifyAdmin, getAllTeachersForAdmin);
router.patch('/teachers/update/:id', verifyToken, verifyAdmin, updateTeacherStatusManually);

// 🔥 The correctly placed Reject Route
router.patch('/reject/:teacherId', verifyToken, verifyAdmin, rejectTeacher);

export default router;