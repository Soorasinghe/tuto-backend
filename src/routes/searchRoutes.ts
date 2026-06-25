import { Router } from 'express';
import { searchTeachers, getTrendingTeachers } from '../controllers/searchController';

const router = Router();

// 🌍 Public: MUST BE FIRST!
router.get('/trending', getTrendingTeachers);
router.get('/', searchTeachers);

export default router;