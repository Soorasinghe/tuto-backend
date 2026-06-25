import { Router } from 'express';
import { runDailyDowngrades } from '../controllers/cronController';

const router = Router();

// ⚠️ Note: For production, you will want to secure this endpoint with a 
// secret API Key in the headers so random bots can't trigger your downgrades.
router.get('/daily-check', runDailyDowngrades);

export default router;