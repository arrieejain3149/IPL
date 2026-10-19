const { db, admin } = require('../firestore-adapter');

const newPlayers = [
  {
    order: 212,
    id: 'p_main_212',
    name: 'AB de Villiers',
    category: 'BATSMAN',
    basePrice: 20000000,
    points: 98,
    pool: 'POOL-1 Batsman',
    country: 'SA',
    imageUrl: '/players/ab_devilliers.jpeg',
  },
  {
    order: 213,
    id: 'p_main_213',
    name: 'Chris Gayle',
    category: 'BATSMAN',
    basePrice: 20000000,
    points: 96,
    pool: 'POOL-1 Batsman',
    country: 'WI',
    imageUrl: '/players/chris_gayle.jpeg',
  },
  {
    order: 214,
    id: 'p_main_214',
    name: 'Suresh Raina',
    category: 'BATSMAN',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-1 Batsman',
    country: 'IND',
    imageUrl: '/players/suresh_raina.jpeg',
  },
  {
    order: 215,
    id: 'p_main_215',
    name: 'Lasith Malinga',
    category: 'BOWLER',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-2 Bowler',
    country: 'SL',
    imageUrl: '/players/lasith_malinga.jpeg',
  },
  {
    order: 216,
    id: 'p_main_216',
    name: 'Dwayne Bravo',
    category: 'BOWLER',
    basePrice: 20000000,
    points: 98,
    pool: 'POOL-2 Bowler',
    country: 'WI',
    imageUrl: '/players/dwayne_bravo.jpeg',
  },
  {
    order: 217,
    id: 'p_main_217',
    name: 'Dale Steyn',
    category: 'BOWLER',
    basePrice: 20000000,
    points: 96,
    pool: 'POOL-2 Bowler',
    country: 'SA',
    imageUrl: '/players/dale_steyn.jpeg',
  },
  {
    order: 218,
    id: 'p_main_218',
    name: 'Andre Russell',
    category: 'ALL_ROUNDER',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-3 All-Rounder',
    country: 'WI',
    imageUrl: '/players/andre_russell.jpeg',
  },
  {
    order: 219,
    id: 'p_main_219',
    name: 'Kieron Pollard',
    category: 'ALL_ROUNDER',
    basePrice: 20000000,
    points: 96,
    pool: 'POOL-3 All-Rounder',
    country: 'WI',
    imageUrl: '/players/kieron_pollard.jpeg',
  },
  {
    order: 220,
    id: 'p_main_220',
    name: 'Dinesh Karthik',
    category: 'WICKET_KEEPER',
    basePrice: 20000000,
    points: 95,
    pool: 'POOL-4 Wicket-Keeper',
    country: 'IND',
    imageUrl: '/players/dinesh_karthik.jpeg',
  },
];

async function run() {
  console.log('Seeding 9 new players to Firestore...');
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  for (const p of newPlayers) {
    const docRef = db.collection('players').doc(p.id);
    batch.set(docRef, {
      id: p.id,
      name: p.name,
      category: p.category,
      basePrice: p.basePrice,
      points: p.points,
      pool: p.pool,
      country: p.country,
      imageUrl: p.imageUrl,
      locationId: 'main_arena',
      status: 'UPCOMING',
      currentBid: null,
      currentBidTeamId: null,
      currentBidId: null,
      soldPrice: null,
      teamId: null,
      order: p.order,
      timerPaused: false,
      timerDeadlineMs: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
  console.log('Successfully committed 9 players to Firestore!');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to add players:', err);
    process.exit(1);
  });
