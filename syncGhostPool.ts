import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';

export interface CompactGhostUnit {
  templateId: string;
  level: number;
  copies: number;
  attack: number;
  health: number;
  maxHealth: number;
  perks?: string[];
  shieldValue?: number;
  foil?: string;
  altArtId?: string;
  mods?: {
    id: string;
    name: string;
    bonusAttack: number;
    bonusHealth: number;
    description: string;
    iconName?: string;
  }[];
}

export interface CompactGhostTeamRecord {
  id: string;
  name: string;
  round: number;
  timestamp: number;
  wins?: number;
  losses?: number;
  teamFoilId?: string;
  arenaSkinId?: string;
  slots: (CompactGhostUnit | null)[];
}

export interface GhostPoolStore {
  version: number;
  lastSyncTimestamp: number;
  lastSyncDate: string;
  totalReadsPerformed: number;
  rounds: {
    [roundNum: string]: CompactGhostTeamRecord[];
  };
}

const EARLIEST_GHOST_TEAM_TIMESTAMP = 1790349000000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEAMS_PER_ROUND = 100; // Cap per round (max 3,500 teams, ~3-4 MB raw JSON)

async function runGhostSync() {
  console.log('====================================================');
  console.log('🚀 Mega Auto Matrix Assault - Ghost Pool Daily Sync');
  console.log('====================================================');

  const rootDir = process.cwd();
  const configPath = path.join(rootDir, 'firebase-applet-config.json');
  const poolPath = path.join(rootDir, 'ghost-pool.json');

  if (!fs.existsSync(configPath)) {
    console.error(`❌ Missing firebase-applet-config.json at ${configPath}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const app = getApps().length > 0 ? getApp() : initializeApp(config);
  const db = getFirestore(app, config.firestoreDatabaseId);

  // Load existing pool
  let store: GhostPoolStore = {
    version: 1,
    lastSyncTimestamp: 0,
    lastSyncDate: '',
    totalReadsPerformed: 0,
    rounds: {},
  };

  if (fs.existsSync(poolPath)) {
    try {
      const raw = fs.readFileSync(poolPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.rounds === 'object') {
        store = parsed;
        console.log(`📦 Loaded existing pool from ${poolPath}`);
      }
    } catch (e) {
      console.warn('⚠️ Could not parse existing pool, initializing empty structure');
    }
  }

  // Ensure all 35 rounds exist
  for (let r = 1; r <= 35; r++) {
    if (!store.rounds[String(r)]) {
      store.rounds[String(r)] = [];
    }
  }

  const now = Date.now();
  const oneWeekAgo = now - ONE_WEEK_MS;
  const teamsCol = collection(db, 'ghost_teams');

  let totalReads = 0;
  let totalNewAdded = 0;

  for (let r = 1; r <= 35; r++) {
    const roundKey = String(r);
    const existingTeams = store.rounds[roundKey] || [];
    const existingIds = new Set(existingTeams.map((t) => t.id));
    let newThisRound = 0;

    // Daily read distribution:
    // Rounds 1-5 (Tier 1): 8 reads/round (4 newest + 4 historic)
    // Rounds 6-10 (Tier 2): 8 reads/round (4 newest + 4 historic)
    // Rounds 11-20 (Mid-Endless): 7 reads/round (4 newest + 3 historic)
    // Rounds 21-35 (Late-Endless): 6 reads/round (4 newest + 2 historic)
    const newestCount = 4;
    const historicCount = r <= 10 ? 4 : r <= 20 ? 3 : 2;

    try {
      // 1. Fetch newest teams from the last 7 days
      const qNewest = query(
        teamsCol,
        where('round', '==', r),
        where('timestamp', '>=', oneWeekAgo),
        orderBy('timestamp', 'desc'),
        limit(newestCount)
      );

      const snapNewest = await getDocs(qNewest);
      totalReads += snapNewest.size;

      snapNewest.forEach((d) => {
        const data = d.data() as CompactGhostTeamRecord;
        if (data && data.slots && data.slots.some((s) => s !== null)) {
          const docId = data.id || d.id;
          if (!existingIds.has(docId)) {
            existingTeams.unshift({ ...data, id: docId, round: r });
            existingIds.add(docId);
            newThisRound++;
            totalNewAdded++;
          }
        }
      });

      // 2. Fetch historic teams across the timeline
      if (historicCount > 0) {
        const randomAnchor = Math.random();
        const qHistoric = query(
          teamsCol,
          where('round', '==', r),
          where('randomSeed', '>=', randomAnchor),
          orderBy('randomSeed', 'asc'),
          limit(historicCount)
        );

        let snapHistoric = await getDocs(qHistoric);
        totalReads += snapHistoric.size;

        if (snapHistoric.size === 0) {
          const qFallback = query(
            teamsCol,
            where('round', '==', r),
            where('timestamp', '>=', EARLIEST_GHOST_TEAM_TIMESTAMP),
            orderBy('timestamp', 'asc'),
            limit(historicCount)
          );
          const snapFallback = await getDocs(qFallback);
          totalReads += snapFallback.size;
          snapHistoric = snapFallback;
        }

        snapHistoric.forEach((d) => {
          const data = d.data() as CompactGhostTeamRecord;
          if (data && data.slots && data.slots.some((s) => s !== null)) {
            const docId = data.id || d.id;
            if (!existingIds.has(docId)) {
              existingTeams.push({ ...data, id: docId, round: r });
              existingIds.add(docId);
              newThisRound++;
              totalNewAdded++;
            }
          }
        });
      }

      // Cap pool size per round to keep bundle lightweight
      if (existingTeams.length > MAX_TEAMS_PER_ROUND) {
        store.rounds[roundKey] = existingTeams.slice(0, MAX_TEAMS_PER_ROUND);
      } else {
        store.rounds[roundKey] = existingTeams;
      }

      console.log(
        `  Round ${r.toString().padStart(2, ' ')}: +${newThisRound} new teams (Pool: ${store.rounds[roundKey].length}) [planned: ${newestCount} new, ${historicCount} hist]`
      );
    } catch (roundErr: any) {
      console.warn(`  ⚠️ Round ${r} failed:`, roundErr?.message || roundErr);
    }
  }

  store.lastSyncTimestamp = now;
  store.lastSyncDate = new Date().toISOString().split('T')[0];
  store.totalReadsPerformed = (store.totalReadsPerformed || 0) + totalReads;

  // Count total teams
  let totalTeamsInPool = 0;
  for (let r = 1; r <= 35; r++) {
    totalTeamsInPool += (store.rounds[String(r)] || []).length;
  }

  // Write to ghost-pool.json
  fs.writeFileSync(poolPath, JSON.stringify(store, null, 2), 'utf-8');

  console.log('----------------------------------------------------');
  console.log(`✅ Sync complete!`);
  console.log(`📊 Reads consumed: ${totalReads} (Budget: 245 max)`);
  console.log(`🆕 New teams added: ${totalNewAdded}`);
  console.log(`📚 Total teams in pool: ${totalTeamsInPool}`);
  console.log(`💾 Saved to: ${poolPath}`);
  console.log('====================================================');
}

runGhostSync()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Fatal sync error:', err);
    process.exit(1);
  });
