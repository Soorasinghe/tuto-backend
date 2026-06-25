import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { db } from '../config/firebase'; // Ensure this points to your firebase config file

export const verifyAdmin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Ensure the user token was verified by the previous middleware
    if (!req.user || !req.user.uid) {
      res.status(401).json({ success: false, message: 'Unauthorized: No user found.' });
      return;
    }

    // 2. Look up the user in Firestore to check their role
    const teacherDoc = await db.collection('teachers').doc(req.user.uid).get();
    
    if (!teacherDoc.exists) {
      res.status(403).json({ success: false, message: 'Forbidden: User record not found.' });
      return;
    }

    const userData = teacherDoc.data();

    // 3. Check if they have the VIP 'admin' badge
    if (userData?.role === 'admin') {
      next(); // Let them through!
    } else {
      res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
    }
  } catch (error) {
    console.error('❌ Error verifying admin status:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};