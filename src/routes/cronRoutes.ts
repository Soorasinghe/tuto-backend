import { Router } from 'express';
import { runDailyDowngrades } from '../controllers/cronController';

const router = Router();

// 🔒 Secured inside the controller with CRON_SECRET (Vercel Cron sends it automatically
// as "Authorization: Bearer <CRON_SECRET>" when the env var is set).
router.get('/daily-check', runDailyDowngrades);

export default router;
