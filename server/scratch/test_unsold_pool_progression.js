const assert = require('assert');

// 1. Logic helpers under test
const isUnsoldPool = (poolStr) => {
  if (!poolStr) return false;
  const s = String(poolStr).trim().toLowerCase();
  return s === 'unsold' || s.includes('unsold');
};

const getPoolNumber = (poolStr, category) => {
  if (poolStr) {
    if (isUnsoldPool(poolStr)) return 5;
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

console.log('--- 1. Testing getPoolNumber for Unsold pool ---');
assert.strictEqual(getPoolNumber('Unsold'), 5);
assert.strictEqual(getPoolNumber('POOL-Unsold'), 5);
assert.strictEqual(getPoolNumber('POOL-5 Unsold'), 5);
assert.strictEqual(getPoolNumber('POOL-1 Batsman'), 1);
assert.strictEqual(getPoolNumber('POOL-2 Bowler'), 2);
assert.strictEqual(getPoolNumber('POOL-3 All-Rounder'), 3);
assert.strictEqual(getPoolNumber('POOL-4 Wicket-Keeper'), 4);
console.log('✅ PASS: getPoolNumber assigns 5 to Unsold pool, ranking strictly after Pool 4.');

console.log('--- 2. Testing Full Auto-Pilot Sequential Simulation with Unsold lots ---');
// Create a mock dataset: 2 Batsmen, 2 Bowlers, 2 All-Rounders, 2 Wicket-Keepers
let players = [
  { id: 'p1', name: 'Batsman 1', pool: 'POOL-1 Batsman', category: 'BATSMAN', status: 'UPCOMING', order: 1 },
  { id: 'p2', name: 'Batsman 2', pool: 'POOL-1 Batsman', category: 'BATSMAN', status: 'UPCOMING', order: 2 },
  { id: 'p3', name: 'Bowler 1', pool: 'POOL-2 Bowler', category: 'BOWLER', status: 'UPCOMING', order: 3 },
  { id: 'p4', name: 'Bowler 2', pool: 'POOL-2 Bowler', category: 'BOWLER', status: 'UPCOMING', order: 4 },
  { id: 'p5', name: 'All-Rounder 1', pool: 'POOL-3 All-Rounder', category: 'ALL_ROUNDER', status: 'UPCOMING', order: 5 },
  { id: 'p6', name: 'All-Rounder 2', pool: 'POOL-3 All-Rounder', category: 'ALL_ROUNDER', status: 'UPCOMING', order: 6 },
  { id: 'p7', name: 'Keeper 1', pool: 'POOL-4 Wicket-Keeper', category: 'WICKET_KEEPER', status: 'UPCOMING', order: 7 },
  { id: 'p8', name: 'Keeper 2', pool: 'POOL-4 Wicket-Keeper', category: 'WICKET_KEEPER', status: 'UPCOMING', order: 8 },
];

let livePlayer = null;
let poolFilter = 'ALL';
const auctionedSequence = [];

function advanceNextPlayerSim() {
  const regularPoolPlayers = players
    .filter(p => p.status === 'UPCOMING' && p.id !== livePlayer?.id && !isUnsoldPool(p.pool))
    .sort(sortPlayersByPool);

  const unsoldPoolPlayers = players
    .filter(p => (isUnsoldPool(p.pool) || p.status === 'UNSOLD') && p.status !== 'SOLD' && p.id !== livePlayer?.id)
    .sort(sortPlayersByPool);

  const availablePlayers = regularPoolPlayers.length > 0 
    ? regularPoolPlayers 
    : unsoldPoolPlayers;

  if (availablePlayers.length === 0) return null;

  let activePool = null;
  if (poolFilter && poolFilter !== 'ALL') {
    activePool = poolFilter;
  } else if (livePlayer && livePlayer.pool) {
    activePool = livePlayer.pool;
  }

  let poolSource = availablePlayers;
  if (isUnsoldPool(activePool)) {
    poolSource = unsoldPoolPlayers;
  }

  let candidatesInPool = activePool
    ? poolSource.filter(p => isUnsoldPool(activePool) ? (isUnsoldPool(p.pool) || p.status === 'UNSOLD') : p.pool === activePool)
    : [];

  if (candidatesInPool.length === 0) {
    const uniqueRemainingPools = [];
    for (const p of availablePlayers) {
      const pPool = isUnsoldPool(p.pool) ? 'Unsold' : (p.pool || 'Unassigned');
      if (!uniqueRemainingPools.includes(pPool)) {
        uniqueRemainingPools.push(pPool);
      }
    }

    if (uniqueRemainingPools.length > 0) {
      const nextPool = uniqueRemainingPools[0];
      candidatesInPool = availablePlayers.filter(p => isUnsoldPool(nextPool) ? (isUnsoldPool(p.pool) || p.status === 'UNSOLD') : (p.pool || 'Unassigned') === nextPool);
      if (poolFilter !== 'ALL') {
        poolFilter = nextPool;
      }
    }
  }

  return candidatesInPool.length > 0 ? candidatesInPool[0] : (availablePlayers.length > 0 ? availablePlayers[0] : null);
}

// SIMULATE AUCTION:
// Suppose Batsman 1 and Bowler 2 go UNSOLD in their regular rounds.
// All other players are SOLD.
// In the Unsold round, Batsman 1 and Bowler 2 get resolved.
while (true) {
  const next = advanceNextPlayerSim();
  if (!next) break;

  livePlayer = next;
  auctionedSequence.push({ name: next.name, pool: next.pool });

  if (next.pool === 'Unsold') {
    // In the Unsold round, resolved!
    players = players.map(p => p.id === next.id ? { ...p, status: 'SOLD' } : p);
  } else if (next.id === 'p1' || next.id === 'p4') {
    // Regular round: passed UNSOLD
    const unsoldItem = { ...next, status: 'UNSOLD', pool: 'Unsold' };
    players = players.map(p => p.id === next.id ? unsoldItem : p);
  } else {
    // Regular round: SOLD
    players = players.map(p => p.id === next.id ? { ...p, status: 'SOLD' } : p);
  }
}

console.log('Auctioned Sequence:');
auctionedSequence.forEach((item, idx) => {
  console.log(`  ${idx + 1}. [${item.pool}] ${item.name}`);
});

// Verify sequence:
// Batsmen -> Bowlers -> All-Rounders -> Keepers -> Unsold!
assert.strictEqual(auctionedSequence[0].name, 'Batsman 1');
assert.strictEqual(auctionedSequence[1].name, 'Batsman 2');
assert.strictEqual(auctionedSequence[2].name, 'Bowler 1');
assert.strictEqual(auctionedSequence[3].name, 'Bowler 2');
assert.strictEqual(auctionedSequence[4].name, 'All-Rounder 1');
assert.strictEqual(auctionedSequence[5].name, 'All-Rounder 2');
assert.strictEqual(auctionedSequence[6].name, 'Keeper 1');
assert.strictEqual(auctionedSequence[7].name, 'Keeper 2');

// Only AFTER all 4 regular pools are completed: Unsold pool comes!
assert.strictEqual(auctionedSequence[8].name, 'Batsman 1');
assert.strictEqual(auctionedSequence[8].pool, 'Unsold');
assert.strictEqual(auctionedSequence[9].name, 'Bowler 2');
assert.strictEqual(auctionedSequence[9].pool, 'Unsold');

console.log('✅ PASS: All 4 regular pools completed first, then Unsold pool followed automatically!');
