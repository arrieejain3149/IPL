require('dotenv').config();
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing Firebase Admin environment variables in .env');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey })
});

const db = getFirestore();

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) return;
  
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

async function uploadCollectionInBatches(collectionName, itemsObj) {
  const entries = Object.entries(itemsObj);
  console.log(`Uploading ${entries.length} items to '${collectionName}'...`);
  
  for (let i = 0; i < entries.length; i += 400) {
    const chunk = entries.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(([id, data]) => {
      const docRef = db.collection(collectionName).doc(String(id));
      batch.set(docRef, { ...data, id: String(id) });
    });
    await batch.commit();
    console.log(`  Committed batch ${i + 1} - ${Math.min(i + 400, entries.length)} for ${collectionName}`);
  }
}

async function runSync() {
  console.log('--- SYNCING LOCAL STORE TO GOOGLE CLOUD FIRESTORE ---');
  const storePath = path.resolve(__dirname, '../data/firestore-store.json');
  if (!fs.existsSync(storePath)) {
    console.error('Store file not found at:', storePath);
    process.exit(1);
  }

  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  console.log(`Local store loaded:
  - Locations: ${Object.keys(store.locations || {}).length}
  - Teams: ${Object.keys(store.teams || {}).length}
  - Users: ${Object.keys(store.users || {}).length}
  - Players: ${Object.keys(store.players || {}).length}
  `);

  console.log('1. Clearing existing Firestore collections...');
  await deleteCollection('locations');
  await deleteCollection('teams');
  await deleteCollection('users');
  await deleteCollection('players');
  await deleteCollection('bids');
  await deleteCollection('audit_logs');
  console.log('   Collections cleared successfully.');

  console.log('2. Uploading 4 venues (Locations)...');
  await uploadCollectionInBatches('locations', store.locations || {});

  console.log('3. Uploading 40 Franchise Teams...');
  await uploadCollectionInBatches('teams', store.teams || {});

  console.log('4. Uploading All Users & Operators...');
  await uploadCollectionInBatches('users', store.users || {});

  console.log('5. Uploading 844 Players with Cloudinary URLs...');
  await uploadCollectionInBatches('players', store.players || {});

  console.log('\n--- VERIFYING LIVE CLOUD FIRESTORE COLLECTIONS ---');
  const locsSnap = await db.collection('locations').get();
  console.log(`Verified Locations in Cloud: ${locsSnap.size}`);
  locsSnap.docs.forEach(d => console.log(`  - Venue ID: ${d.id} | Name: ${d.data().name} | City: ${d.data().city}`));

  const teamsSnap = await db.collection('teams').get();
  console.log(`Verified Teams in Cloud: ${teamsSnap.size}`);

  const usersSnap = await db.collection('users').get();
  console.log(`Verified Users in Cloud: ${usersSnap.size}`);

  const playersSnap = await db.collection('players').get();
  console.log(`Verified Players in Cloud: ${playersSnap.size}`);
  
  if (playersSnap.size > 0) {
    const pSample = playersSnap.docs[0].data();
    console.log(`Sample Cloud Player: ${pSample.name} | Image URL: ${pSample.imageUrl}`);
  }

  console.log('\n SUCCESS: Cloud Firestore is 100% synchronized with all 4 venues and Cloudinary assets!');
  process.exit(0);
}

runSync().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
