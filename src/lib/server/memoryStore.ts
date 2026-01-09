// src/lib/server/memoryStore.ts
export type LeaderboardEntry = {
  wallet: string;
  points: number;
  completed: number;
  updatedAt: number;
};

type MemStore = {
  pointsByWallet: Map<string, number>;
  completedIdsByWallet: Map<string, Set<string>>;
  leaderboardByWallet: Map<string, LeaderboardEntry>;
};

const g = globalThis as any;

export const memStore: MemStore =
  g.__ONE_MISSION_MEM_STORE__ ??
  (g.__ONE_MISSION_MEM_STORE__ = {
    pointsByWallet: new Map(),
    completedIdsByWallet: new Map(),
    leaderboardByWallet: new Map(),
  });
