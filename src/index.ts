import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import './config/firebase';
import teacherRoutes from './routes/teacherRoutes';
import searchRoutes from './routes/searchRoutes'; 
import adminRoutes from './routes/adminRoutes'; 
import subscriptionRoutes from './routes/subscriptionRoutes'; 
import adRoutes from './routes/adRoutes';
import cronRoutes from './routes/cronRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// 🔥 PRODUCTION CORS CONFIGURATION
const allowedOrigins = [
  'http://localhost:3000',     // Allow your local development environment
  'https://www.tuto.lk',       // Your future custom domain
  'https://tuto.lk',
  'https://tuto-lk-frontend.vercel.app' // <-- Your active Vercel frontend
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, or server-to-server requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS Rules'));
    }
  },
  credentials: true // Important if you ever add cookies or strict auth sessions later
}));

// Middleware
app.use(express.json());

// --- API Routes ---
app.use('/api/teachers', teacherRoutes);
app.use('/api/search', searchRoutes); 
app.use('/api/admin', adminRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/ads', adRoutes);
app.use('/api/cron', cronRoutes);

// Base Health Check Route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', message: 'Tuto.lk API is running smoothly.' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is flying on port ${PORT}`);
});