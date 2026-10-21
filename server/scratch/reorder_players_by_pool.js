const fs = require('fs');
const path = require('path');

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

// 1. Reorder server/scratch/all_211_players.json
const scratchPath = path.resolve(__dirname, 'all_211_players.json');
if (fs.existsSync(scratchPath)) {
  const players = JSON.parse(fs.readFileSync(scratchPath, 'utf8'));
  players.sort(sortPlayers);
  fs.writeFileSync(scratchPath, JSON.stringify(players, null, 2), 'utf8');
  console.log(`✅ Sorted ${players.length} players in ${scratchPath}`);
}

// 2. Reorder store files
const storePaths = [
  path.resolve(__dirname, '../data/firestore-store.json'),
  path.resolve(__dirname, '../../api/data/firestore-store.json'),
  path.resolve(__dirname, '../../client/api/data/firestore-store.json'),
];

storePaths.forEach(sp => {
  if (!fs.existsSync(sp)) return;
  const store = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (!store.players) return;

  // Group by locationId
  const byLocation = {};
  Object.entries(store.players).forEach(([id, p]) => {
    const loc = p.locationId || 'main_arena';
    if (!byLocation[loc]) byLocation[loc] = [];
    byLocation[loc].push({ id, ...p });
  });

  Object.entries(byLocation).forEach(([loc, locPlayers]) => {
    locPlayers.sort(sortPlayers);
    locPlayers.forEach((p, idx) => {
      if (store.players[p.id]) {
        store.players[p.id].order = idx + 1;
      }
    });
    console.log(`  Location ${loc}: sorted & updated order (1..${locPlayers.length})`);
  });

  fs.writeFileSync(sp, JSON.stringify(store, null, 2), 'utf8');
  console.log(`✅ Updated store: ${sp}`);
});
