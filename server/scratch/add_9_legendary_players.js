const fs = require('fs');
const path = require('path');

const newPlayers = [
  // Batsmen
  {
    name: 'AB de Villiers',
    category: 'BATSMAN',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 98,
    pool: 'POOL-1 Batsman',
    imageUrl: 'https://ui-avatars.com/api/?name=AB+de+Villiers&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  {
    name: 'Chris Gayle',
    category: 'BATSMAN',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 96,
    pool: 'POOL-1 Batsman',
    imageUrl: 'https://ui-avatars.com/api/?name=Chris+Gayle&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  {
    name: 'Suresh Raina',
    category: 'BATSMAN',
    country: 'IND',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-1 Batsman',
    imageUrl: 'https://ui-avatars.com/api/?name=Suresh+Raina&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  // Bowlers
  {
    name: 'Lasith Malinga',
    category: 'BOWLER',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-2 Bowler',
    imageUrl: 'https://ui-avatars.com/api/?name=Lasith+Malinga&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  {
    name: 'Dwayne Bravo',
    category: 'BOWLER',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 98,
    pool: 'POOL-2 Bowler',
    imageUrl: 'https://ui-avatars.com/api/?name=Dwayne+Bravo&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  {
    name: 'Dale Steyn',
    category: 'BOWLER',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 96,
    pool: 'POOL-2 Bowler',
    imageUrl: 'https://ui-avatars.com/api/?name=Dale+Steyn&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  // All Rounders
  {
    name: 'Andre Russell',
    category: 'ALL_ROUNDER',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-3 All-Rounder',
    imageUrl: 'https://ui-avatars.com/api/?name=Andre+Russell&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  {
    name: 'Kieron Pollard',
    category: 'ALL_ROUNDER',
    country: 'OVERSEAS',
    basePrice: 20000000,
    points: 96,
    pool: 'POOL-3 All-Rounder',
    imageUrl: 'https://ui-avatars.com/api/?name=Kieron+Pollard&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  },
  // Wicket Keeper
  {
    name: 'Dinesh Karthik',
    category: 'WICKET_KEEPER',
    country: 'IND',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-4 Wicket-Keeper',
    imageUrl: 'https://ui-avatars.com/api/?name=Dinesh+Karthik&background=1a2332&color=ffd700&size=256&bold=true',
    status: 'UPCOMING'
  }
];

const getPoolNumber = (poolStr, category) => {
  if (poolStr) {
    const match = String(poolStr).match(/POOL\s*[-]?\s*(\d+)/i);
    if (match) return parseInt(match[1], 10);
  }
  const cat = String(category || '').toUpperCase();
  if (cat.includes('BAT')) return 1;
  if (cat.includes('BOWL')) return 2;
  if (cat.includes('ALL') || cat.includes('AR')) return 3;
  if (cat.includes('KEEP') || cat.includes('WK')) return 4;
  return 999;
};

const sortPlayers = (a, b) => {
  const pA = getPoolNumber(a.pool, a.category);
  const pB = getPoolNumber(b.pool, b.category);
  if (pA !== pB) return pA - pB;
  if (a.pool && b.pool && a.pool !== b.pool) {
    return a.pool.localeCompare(b.pool);
  }
  return (a.name || '').localeCompare(b.name || '');
};

// 1. Update scratch all_211_players.json to all 220 players
const scratchPath = path.resolve(__dirname, 'all_211_players.json');
let existingScratch = JSON.parse(fs.readFileSync(scratchPath, 'utf8'));
// Filter out if any of new players already added
const newNames = new Set(newPlayers.map(p => p.name.toLowerCase()));
existingScratch = existingScratch.filter(p => !newNames.has(p.name.toLowerCase()));
const full220 = [...existingScratch, ...newPlayers];
full220.sort(sortPlayers);
fs.writeFileSync(scratchPath, JSON.stringify(full220, null, 2), 'utf8');
console.log(`✅ Updated ${scratchPath} to ${full220.length} players`);

// 2. Update playerImageMap.json
const mapPath = path.resolve(__dirname, '../../client/src/playerImageMap.json');
if (fs.existsSync(mapPath)) {
  const imgMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  newPlayers.forEach(p => {
    const clean = p.name.toLowerCase().replace(/[^a-z]/g, '');
    imgMap[clean] = p.imageUrl;
  });
  imgMap['dineshkartik'] = 'https://ui-avatars.com/api/?name=Dinesh+Karthik&background=1a2332&color=ffd700&size=256&bold=true';
  fs.writeFileSync(mapPath, JSON.stringify(imgMap, null, 2), 'utf8');
  console.log(`✅ Updated ${mapPath} with 9 new players`);
}

// 3. Update store files
const storePaths = [
  path.resolve(__dirname, '../data/firestore-store.json'),
  path.resolve(__dirname, '../../api/data/firestore-store.json'),
  path.resolve(__dirname, '../../client/api/data/firestore-store.json'),
];

storePaths.forEach(sp => {
  if (!fs.existsSync(sp)) return;
  const store = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (!store.players) return;

  const locPrefixes = {
    'main_arena': 'p_main_',
    'id_1792263277245_vc2zpt': 'p_vc2zpt_',
    'id_1792263284468_08g4ec': 'p_08g4ec_',
    'id_1792263284471_fft9q7': 'p_fft9q7_',
  };

  Object.entries(locPrefixes).forEach(([locId, prefix]) => {
    // Check if new players already exist in this location
    const existingInLoc = Object.entries(store.players)
      .filter(([_, p]) => p.locationId === locId);

    const existingNames = new Set(existingInLoc.map(([_, p]) => p.name.toLowerCase()));

    let nextIndex = 212;
    newPlayers.forEach(np => {
      if (!existingNames.has(np.name.toLowerCase())) {
        const pId = `${prefix}${nextIndex++}`;
        store.players[pId] = {
          name: np.name,
          category: np.category,
          basePrice: np.basePrice,
          points: np.points,
          pool: np.pool,
          country: np.country,
          imageUrl: np.imageUrl,
          locationId: locId,
          status: 'UPCOMING',
          currentBid: null,
          currentBidTeamId: null,
          currentBidId: null,
          soldPrice: null,
          teamId: null,
          order: 999,
          createdAt: {},
          updatedAt: {},
          timerDeadlineMs: null,
          timerPaused: false
        };
      }
    });

    // Now re-sort and assign order 1..220 for this location
    const allLocPlayers = Object.entries(store.players)
      .filter(([_, p]) => p.locationId === locId)
      .map(([id, p]) => ({ id, ...p }));

    allLocPlayers.sort(sortPlayers);
    allLocPlayers.forEach((p, idx) => {
      store.players[p.id].order = idx + 1;
    });

    console.log(`  Location ${locId}: now has ${allLocPlayers.length} players (order 1..${allLocPlayers.length})`);
  });

  fs.writeFileSync(sp, JSON.stringify(store, null, 2), 'utf8');
  console.log(`✅ Updated store: ${sp}`);
});
