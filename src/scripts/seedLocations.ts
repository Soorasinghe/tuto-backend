import { db } from '../config/firebase';
import { readFileSync } from 'fs';
import { join } from 'path';

type LocationData = Record<string, unknown>;

const locationsData: LocationData[] = JSON.parse(
  readFileSync(join(__dirname, 'sample-locations.json'), 'utf-8')
);

const seedLocations = async () => {
  console.log('🌱 Starting location seeding process...');
  
  const BATCH_SIZE = 400; // Stay safely under Firestore's 500 limit
  let batchCount = 0;
  let totalSeeded = 0;

  try {
    for (let i = 0; i < locationsData.length; i += BATCH_SIZE) {
      const chunk = locationsData.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      chunk.forEach((location) => {
        // Create a new document reference with an auto-generated ID
        const docRef = db.collection('locations').doc();
        batch.set(docRef, location);
      });

      await batch.commit();
      batchCount++;
      totalSeeded += chunk.length;
      console.log(`✅ Committed batch ${batchCount} (${totalSeeded} locations so far)`);
    }

    console.log(`🎉 Seeding complete! Total locations added: ${totalSeeded}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during seeding:', error);
    process.exit(1);
  }
};

seedLocations();