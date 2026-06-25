import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';

dotenv.config();

try {
  initializeApp({
    credential: applicationDefault(),
  });
  console.log('🔥 Firebase Admin successfully initialized.');
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error);
}

// Export clean, typed instances for your database and auth
export const db = getFirestore();
export const auth = getAuth();