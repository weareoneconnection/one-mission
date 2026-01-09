// ✅ 这里放你项目的“真实链上配置”
// 注意：这两个必须是真实 Solana 地址（base58），不是名字/不是池子/不是钱包

export const ONCHAIN = {
  // WAOC SPL Mint Address（Token 的 Mint 地址，不是 LP 地址）
  WAOC_MINT: "PASTE_WAOC_MINT_ADDRESS_HERE",

  // Genesis Collection Address（通常是 Collection NFT 的 Mint 地址）
  GENESIS_COLLECTION: "PASTE_COLLECTION_ADDRESS_HERE",

  // 规则阈值
  MIN_WAOC: 10_000,
  MIN_SOL: 0.1,
} as const;
