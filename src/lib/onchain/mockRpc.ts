function hash32(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 1 SOL = 1_000_000_000 lamports
export async function mockGetSolLamports(address: string): Promise<number> {
  await delay(450);
  const h = hash32(address + "|sol");
  // 0 ~ 2 SOL
  return (h % 2_000_000_000) + 10_000_000; // ensure >0
}

export async function mockGetSplAmount(address: string, mint: string): Promise<number> {
  await delay(550);
  const h = hash32(address + "|" + mint);
  // 0 ~ 50,000 tokens
  return h % 50_001;
}

export async function mockOwnsNftCollection(address: string, collection: string): Promise<boolean> {
  await delay(600);
  const h = hash32(address + "|" + collection);
  // ~35% 概率持有
  return (h % 100) < 35;
}
