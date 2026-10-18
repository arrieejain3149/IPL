require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const PLAYERS_DIR = path.resolve(__dirname, '../../client/public/players');
const MAP_PATH = path.resolve(__dirname, '../../client/src/playerImageMap.json');
const STORE_PATH = path.resolve(__dirname, '../data/firestore-store.json');
const LOG_PATH = path.resolve(__dirname, '../data/cloudinary-player-map.json');

async function uploadFile(filePath, fileName) {
  // Clean public ID for Cloudinary
  const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/\.[^/.]+$/, ''); // strip double extension if any
  const publicId = baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  const res = await cloudinary.uploader.upload(filePath, {
    folder: 'ipl_auction/players',
    public_id: publicId,
    overwrite: true,
    resource_type: 'image'
  });

  // Inject f_auto,q_auto,w_400,c_limit for optimal bandwidth and instantaneous delivery
  const optimizedUrl = res.secure_url.replace('/upload/', '/upload/f_auto,q_auto,w_400,c_limit/');
  return { fileName, originalPath: `/players/${fileName}`, optimizedUrl, publicId: res.public_id };
}

async function run() {
  console.log('--- Starting Cloudinary Player Photos Migration ---');
  
  if (!fs.existsSync(PLAYERS_DIR)) {
    console.error(`Players directory not found at: ${PLAYERS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(PLAYERS_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  console.log(`Found ${files.length} player photos to upload.`);

  // Upload in parallel batches of 5
  const CONCURRENCY = 5;
  const results = {};
  const fileToUrl = {};

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    const promises = chunk.map(fileName => {
      const fullPath = path.join(PLAYERS_DIR, fileName);
      return uploadFile(fullPath, fileName)
        .then(result => {
          fileToUrl[`/players/${fileName}`] = result.optimizedUrl;
          results[fileName] = result.optimizedUrl;
          console.log(`[${i + results && Object.keys(results).length}/${files.length}] Uploaded: ${fileName} -> ${result.optimizedUrl}`);
        })
        .catch(err => {
          console.error(`FAILED: ${fileName}`, err.message);
        });
    });

    await Promise.all(promises);
  }

  console.log(`\nSuccessfully uploaded ${Object.keys(results).length} images to Cloudinary!`);

  // Save mapping log
  fs.writeFileSync(LOG_PATH, JSON.stringify(fileToUrl, null, 2), 'utf8');
  console.log(`Saved mapping to ${LOG_PATH}`);

  // 1. Update playerImageMap.json
  if (fs.existsSync(MAP_PATH)) {
    fs.copyFileSync(MAP_PATH, MAP_PATH + '.bak');
    const playerMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
    let updatedCount = 0;

    for (const [key, oldPath] of Object.entries(playerMap)) {
      if (oldPath && fileToUrl[oldPath]) {
        playerMap[key] = fileToUrl[oldPath];
        updatedCount++;
      }
    }

    fs.writeFileSync(MAP_PATH, JSON.stringify(playerMap, null, 2), 'utf8');
    console.log(`Updated ${updatedCount} entries in playerImageMap.json (backup saved to .bak).`);
  }

  // 2. Update firestore-store.json
  if (fs.existsSync(STORE_PATH)) {
    fs.copyFileSync(STORE_PATH, STORE_PATH + '.bak');
    const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    let storeUpdatedCount = 0;

    if (store.players) {
      for (const [id, player] of Object.entries(store.players)) {
        if (player.imageUrl && fileToUrl[player.imageUrl]) {
          player.imageUrl = fileToUrl[player.imageUrl];
          storeUpdatedCount++;
        }
      }
    }

    // Also check players inside teams
    if (store.teams) {
      for (const [id, team] of Object.entries(store.teams)) {
        if (team.players && Array.isArray(team.players)) {
          for (const tp of team.players) {
            if (tp.imageUrl && fileToUrl[tp.imageUrl]) {
              tp.imageUrl = fileToUrl[tp.imageUrl];
            }
          }
        }
      }
    }

    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
    console.log(`Updated ${storeUpdatedCount} players in firestore-store.json (backup saved to .bak).`);
  }

  console.log('\n--- Migration Finished Successfully! ---');
}

run().catch(err => {
  console.error('Migration encountered fatal error:', err);
  process.exit(1);
});
