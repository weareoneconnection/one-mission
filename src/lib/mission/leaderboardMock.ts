export type LeaderboardRow = {
  rank: number;
  name: string;
  wallet: string;
  points: number;
};

function shortWallet(i: number) {
  const hex = (i * 2654435761 >>> 0).toString(16).padStart(8, "0");
  return `0x${hex}${hex}${hex}${hex}`; // mock
}

const names = [
  "Nova", "Orion", "Atlas", "Lyra", "Zen", "Kairo", "Mira", "Sage", "Vega", "Astra",
  "Echo", "Riven", "Sol", "Luna", "Rune", "Jade", "Kyro", "Nix", "Iris", "Zara",
];

export function getMockTop100(): Omit<LeaderboardRow, "rank">[] {
  // 生成递减分数（带一点随机扰动）
  const rows = Array.from({ length: 100 }).map((_, idx) => {
    const base = 12000 - idx * 95;
    const jitter = Math.floor(Math.random() * 40); // 0~39
    return {
      name: names[idx % names.length] + (idx + 1),
      wallet: shortWallet(idx + 1),
      points: Math.max(0, base - jitter),
    };
  });

  // 按 points 排序（保险）
  rows.sort((a, b) => b.points - a.points);
  return rows;
}
