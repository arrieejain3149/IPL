const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const { db, admin } = require('../firestore-adapter');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const PLAYERS_DIR = 'D:\\sem 3\\General\\Sabrang\\players';
const MAP_PATH = path.resolve(__dirname, '../../client/src/playerImageMap.json');
const P211_PATH = path.resolve(__dirname, '../../players_211.json');
const SCRATCH_PATH = path.resolve(__dirname, '../scratch/all_211_players.json');
const STORE_PATH = path.resolve(__dirname, '../data/firestore-store.json');

const playersToUpload = [
  {
    file: 'Ab Devilliers.jpeg',
    publicId: 'ab_devilliers',
    docId: 'p_main_212',
    name: 'AB de Villiers',
    mapKeys: ['abdevilliers']
  },
  {
    file: 'Chris gayle.jpeg',
    publicId: 'chris_gayle',
    docId: 'p_main_213',
    name: 'Chris Gayle',
    mapKeys: ['chrisgayle']
  },
  {
    file: 'Suresh raina.jpeg',
    publicId: 'suresh_raina',
    docId: 'p_main_214',
    name: 'Suresh Raina',
    mapKeys: ['sureshraina']
  },
  {
    file: 'Lasith malinga.jpeg',
    publicId: 'lasith_malinga',
    docId: 'p_main_215',
    name: 'Lasith Malinga',
    mapKeys: ['lasithmalinga']
  },
  {
    file: 'Dwayne bravo.jpeg',
    publicId: 'dwayne_bravo',
    docId: 'p_main_216',
    name: 'Dwayne Bravo',
    mapKeys: ['dwaynebravo']
  },
  {
    file: 'Dale steyn.jpeg',
    publicId: 'dale_steyn',
    docId: 'p_main_217',
    name: 'Dale Steyn',
    mapKeys: ['dalesteyn']
  },
  {
    file: 'Andre Russell.jpeg',
    publicId: 'andre_russell',
    docId: 'p_main_218',
    name: 'Andre Russell',
    mapKeys: ['andrerussell']
  },
  {
    file: 'Kieron Pollard.jpeg',
    publicId: 'kieron_pollard',
    docId: 'p_main_219',
    name: 'Kieron Pollard',
    mapKeys: ['kieronpollard']
  },
  {
    file: 'Dinesh kartik.jpeg',
    publicId: 'dinesh_karthik',
    docId: 'p_main_220',
    name: 'Dinesh Karthik',
    mapKeys: ['dineshkarthik', 'dineshkartik']
  }
];

async function run() {
  console.log('--- Uploading 9 Legendary Players to Cloudinary ---');
  console.log('Using Cloud:', process.env.CLOUDINARY_CLOUD_NAME);

  const uploadResults = {};

  for (const item of playersToUpload) {
    const fullPath = path.join(PLAYERS_DIR, item.file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    console.log(`Uploading ${item.file} as ${item.publicId}...`);
    const res = await cloudinary.uploader.upload(fullPath, {
      folder: 'ipl_auction/players',
      public_id: item.publicId,
      overwrite: true,
      resource_type: 'image'
    });

    const optimizedUrl = res.secure_url.replace('/upload/', '/upload/f_auto,q_auto,w_400,c_limit/');
    console.log(`  -> URL: ${optimizedUrl}`);
    uploadResults[item.docId] = {
      ...item,
      cloudinaryUrl: optimizedUrl
    };
  }

  // 1. Update client/src/playerImageMap.json
  console.log('\nUpdating playerImageMap.json...');
  if (fs.existsSync(MAP_PATH)) {
    const playerMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    for (const res of Object.values(uploadResults)) {
      for (const k of res.mapKeys) {
        playerMap[k] = res.cloudinaryUrl;
      }
    }
    fs.writeFileSync(MAP_PATH, JSON.stringify(playerMap, null, 2), 'utf8');
    console.log('Updated playerImageMap.json successfully.');
  }

  // 2. Update players_211.json
  console.log('\nUpdating players_211.json...');
  if (fs.existsSync(P211_PATH)) {
    const p211 = JSON.parse(fs.readFileSync(P211_PATH, 'utf8'));
    for (const res of Object.values(uploadResults)) {
      const match = p211.find(p => p.name === res.name);
      if (match) {
        match.imageUrl = res.cloudinaryUrl;
      }
    }
    fs.writeFileSync(P211_PATH, JSON.stringify(p211, null, 2), 'utf8');
    console.log('Updated players_211.json successfully.');
  }

  // 3. Update server/scratch/all_211_players.json
  console.log('\nUpdating all_211_players.json...');
  if (fs.existsSync(SCRATCH_PATH)) {
    const scratch = JSON.parse(fs.readFileSync(SCRATCH_PATH, 'utf8'));
    for (const res of Object.values(uploadResults)) {
      const match = scratch.find(p => p.name === res.name);
      if (match) {
        match.imageUrl = res.cloudinaryUrl;
      }
    }
    fs.writeFileSync(SCRATCH_PATH, JSON.stringify(scratch, null, 2), 'utf8');
    console.log('Updated all_211_players.json successfully.');
  }

  // 4. Update firestore-store.json (if present)
  if (fs.existsSync(STORE_PATH)) {
    const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (store.players) {
      for (const [docId, res] of Object.entries(uploadResults)) {
        if (store.players[docId]) {
          store.players[docId].imageUrl = res.cloudinaryUrl;
        }
      }
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    console.log('Updated firestore-store.json.');
  }

  // 5. Update Firestore Database
  console.log('\nUpdating Firestore database...');
  const batch = db.batch();
  for (const [docId, res] of Object.entries(uploadResults)) {
    const docRef = db.collection('players').doc(docId);
    batch.update(docRef, {
      imageUrl: res.cloudinaryUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
  console.log('Committed image updates to Firestore!');

  console.log('\n--- All 9 players images uploaded to Cloudinary & synced! ---');
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Upload failed:', err);
    process.exit(1);
  });
