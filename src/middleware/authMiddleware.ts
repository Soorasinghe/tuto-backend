import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { auth } from '../config/firebase';

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
}

export const verifyToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Unauthorized: Missing or invalid token.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken; 
    next(); 
  } catch (error) {
    console.error('❌ Error verifying Firebase token:', error);
    res.status(403).json({ success: false, message: 'Forbidden: Invalid or expired token.' });
  }
};