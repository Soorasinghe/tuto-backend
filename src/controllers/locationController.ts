import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

// This variable will store the built tree in the server's RAM
let cachedLocationTree: any[] | null = null;

export const getLocations = async (req: Request, res: Response): Promise<void> => {
  try {
    // If the tree is already built and cached, return it instantly
    if (cachedLocationTree) {
      res.status(200).json({ success: true, data: cachedLocationTree });
      return;
    }

    console.log("🌲 Building location tree from 13,978 rows...");
    
    // ✅ FIX: Use '../../' to go out of controllers, out of src, and into the root data folder
    const dataPath = path.join(__dirname, '../../data/srilanka_locations.json');
    
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const locations = JSON.parse(rawData);

    const tree: any[] = [];

    locations.forEach((item: any) => {
      // 1. Get or create Province
      let prov = tree.find(p => p.province === item.province);
      if (!prov) { 
        prov = { province: item.province, districts: [] }; 
        tree.push(prov); 
      }

      // 2. Get or create District
      let dist = prov.districts.find((d: any) => d.name === item.district);
      if (!dist) { 
        dist = { name: item.district, cities: [] }; 
        prov.districts.push(dist); 
      }

      // 3. Get or create City
      let city = dist.cities.find((c: any) => c.name === item.city);
      if (!city) { 
        city = { name: item.city, villages: [] }; 
        dist.cities.push(city); 
      }

      // 4. Add Village if not exists
      if (!city.villages.includes(item.village)) {
        city.villages.push(item.village);
      }
    });

    // Save the built structure to RAM for future requests
    cachedLocationTree = tree;
    console.log("⚡ Location tree cached successfully.");

    res.status(200).json({ success: true, data: tree });
  } catch (error) {
    console.error('❌ Error processing locations:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};