const fs = require('fs');
const assert = require('assert');

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

const sortPlayersByPool = (a, b) => {
  const poolA = getPoolNumber(a.pool, a.category);
  const poolB = getPoolNumber(b.pool, b.category);
  if (poolA !== poolB) return poolA - poolB;
  if (a.pool && b.pool && a.pool !== b.pool) {
    return a.pool.localeCompare(b.pool);
  }
  const orderA = typeof a.order === 'number' ? a.order : 999999;
  const orderB = typeof b.order === 'number' ? b.order : 999999;
  if (orderA !== orderB) return orderA - orderB;
  return (a.name || '').localeCompare(b.name || '');
};

const store = JSON.parse(fs.readFileSync('server/data/firestore-store.json', 'utf8'));
const allPlayers = Object.entries(store.players)
  .filter(([_, p]) => p.locationId === 'main_arena')
  .map(([id, p]) => ({ id, ...p }))
  .sort(sortPlayersByPool);

console.log('Testing Sequential Pool Progression Simulation for 220 players...');
console.log(`Total players loaded: ${allPlayers.length}`);
assert.strictEqual(allPlayers.length, 220, `Expected 220 players, got ${allPlayers.length}`);

// Simulation state
let players = [...allPlayers].map(p => ({ ...p, status: 'UPCOMING' }));
let livePlayer = null;
let poolFilter = 'ALL';
const sequenceObserved = [];

function getNextCandidate(targetId) {
  const upcomingPlayers = players
    .filter(p => p.status === 'UPCOMING' && p.id !== livePlayer?.id)
    .sort(sortPlayersByPool);

  if (upcomingPlayers.length === 0 && !targetId) {
    return null;
  }

  let nextCandidate = targetId;
  if (!nextCandidate) {
    let activePool = null;
    if (poolFilter && poolFilter !== 'ALL') {
      activePool = poolFilter;
    } else if (livePlayer && livePlayer.pool) {
      activePool = livePlayer.pool;
    }

    let candidatesInPool = activePool
      ? upcomingPlayers.filter(p => p.pool === activePool)
      : [];

    if (candidatesInPool.length === 0) {
      const uniqueRemainingPools = [];
      for (const p of upcomingPlayers) {
        const pPool = p.pool || 'Unassigned';
        if (!uniqueRemainingPools.includes(pPool)) {
          uniqueRemainingPools.push(pPool);
        }
      }

      if (uniqueRemainingPools.length > 0) {
        const nextPool = uniqueRemainingPools[0];
        candidatesInPool = upcomingPlayers.filter(p => (p.pool || 'Unassigned') === nextPool);
        if (poolFilter !== 'ALL') {
          poolFilter = nextPool;
        }
      }
    }

    if (candidatesInPool.length > 0) {
      nextCandidate = candidatesInPool[0].id;
    } else if (upcomingPlayers.length > 0) {
      nextCandidate = upcomingPlayers[0].id;
    }
  }

  return nextCandidate;
}

// Simulate full auction progression
while (true) {
  const nextId = getNextCandidate();
  if (!nextId) break;

  const playerObj = players.find(p => p.id === nextId);
  livePlayer = playerObj;
  playerObj.status = 'SOLD';
  sequenceObserved.push({ name: playerObj.name, pool: playerObj.pool });
}

console.log(`Observed sequence length: ${sequenceObserved.length}`);
assert.strictEqual(sequenceObserved.length, 220);

// Test 1: First 64 players MUST be POOL-1 Batsman
for (let i = 0; i < 64; i++) {
  assert.strictEqual(
    sequenceObserved[i].pool, 
    'POOL-1 Batsman', 
    `Player #${i + 1} (${sequenceObserved[i].name}) must be POOL-1 Batsman, but got ${sequenceObserved[i].pool}`
  );
}
console.log('✅ TEST 1 PASSED: All first 64 players are strictly from POOL-1 Batsman! (Includes AB de Villiers, Chris Gayle, Suresh Raina)');

// Test 2: Next 80 players (index 64 to 143) MUST be POOL-2 Bowler
for (let i = 64; i < 144; i++) {
  assert.strictEqual(
    sequenceObserved[i].pool, 
    'POOL-2 Bowler', 
    `Player #${i + 1} (${sequenceObserved[i].name}) must be POOL-2 Bowler, but got ${sequenceObserved[i].pool}`
  );
}
console.log('✅ TEST 2 PASSED: All next 80 players are strictly from POOL-2 Bowler! (Includes Lasith Malinga, Dwayne Bravo, Dale Steyn)');

// Test 3: Next 49 players (index 144 to 192) MUST be POOL-3 All-Rounder
for (let i = 144; i < 193; i++) {
  assert.strictEqual(
    sequenceObserved[i].pool, 
    'POOL-3 All-Rounder', 
    `Player #${i + 1} (${sequenceObserved[i].name}) must be POOL-3 All-Rounder, but got ${sequenceObserved[i].pool}`
  );
}
console.log('✅ TEST 3 PASSED: All next 49 players are strictly from POOL-3 All-Rounder! (Includes Andre Russell, Kieron Pollard)');

// Test 4: Next 27 players (index 193 to 219) MUST be POOL-4 Wicket-Keeper
for (let i = 193; i < 220; i++) {
  assert.strictEqual(
    sequenceObserved[i].pool, 
    'POOL-4 Wicket-Keeper', 
    `Player #${i + 1} (${sequenceObserved[i].name}) must be POOL-4 Wicket-Keeper, but got ${sequenceObserved[i].pool}`
  );
}
console.log('✅ TEST 4 PASSED: All next 27 players are strictly from POOL-4 Wicket-Keeper! (Includes Dinesh Karthik)');

// Test 5: Manual load option test
players = [...allPlayers].map(p => ({ ...p, status: 'UPCOMING' }));
livePlayer = null;
poolFilter = 'ALL';

let c1 = getNextCandidate();
let p1 = players.find(p => p.id === c1);
assert.strictEqual(p1.pool, 'POOL-1 Batsman');
p1.status = 'SOLD';
livePlayer = p1;

// Auctioneer manually clicks LOAD on Dale Steyn
const bowler = players.find(p => p.name === 'Dale Steyn');
let loadedId = getNextCandidate(bowler.id);
assert.strictEqual(loadedId, bowler.id);
let loadedPlayer = players.find(p => p.id === loadedId);
loadedPlayer.status = 'SOLD';
livePlayer = loadedPlayer;

let nextAfterLoad = getNextCandidate();
let pAfterLoad = players.find(p => p.id === nextAfterLoad);
assert.strictEqual(pAfterLoad.pool, 'POOL-2 Bowler', 'After manual load of Dale Steyn, automated queue continues in bowler pool');
console.log('✅ TEST 5 PASSED: Manual LOAD of Dale Steyn correctly overrides pool, and automated next player continues in bowler pool.');

console.log('\n🎉 ALL 5 TESTS FOR 220 PLAYERS PASSED PERFECTLY!');
