const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const { db } = require('../firestore-adapter');

const COLLECTIONS = ['locations', 'teams', 'players', 'bids', 'users', 'audit_logs'];

const TARGET_FILES = [
  path.resolve(__dirname, '../data/firestore-store.json'),
  path.resolve(__dirname, '../../api/data/firestore-store.json'),
  path.resolve(__dirname, '../../client/api/data/firestore-store.json'),
];

async function dumpFirestore() {
  console.log('Fetching all collections from Firestore...');
  const store = {};

  for (const col of COLLECTIONS) {
    store[col] = {};
    const snap = await db.collection(col).get();
    snap.forEach((doc) => {
      const data = doc.data();
      // Normalize timestamp fields to ISO strings or null
      const cleanData = {};
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && v._seconds !== undefined) {
          cleanData[k] = new Date(v._seconds * 1000).toISOString();
        } else {
          cleanData[k] = v;
        }
      }
      store[col][doc.id] = { id: doc.id, ...cleanData };
    });
    console.log(`  Collection '${col}': ${Object.keys(store[col]).length} documents.`);
  }

  const jsonStr = JSON.stringify(store, null, 2);

  for (const target of TARGET_FILES) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(target, jsonStr, 'utf8');
    console.log(`Updated: ${target}`);
  }

  console.log('Successfully synchronized Firestore database to all firestore-store.json files!');
}

dumpFirestore()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error dumping Firestore:', err);
    process.exit(1);
  });
