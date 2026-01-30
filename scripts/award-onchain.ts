// scripts/award-onchain.ts
import "dotenv/config";

async function main() {
  const wallet = process.argv[2];
  const amount = Number(process.argv[3]);

  if (!wallet || !Number.isFinite(amount) || amount <= 0) {
    console.error("Usage: tsx scripts/award-onchain.ts <wallet> <amount>");
    process.exit(1);
  }

  // ✅ 动态 import 放进 main()，避免 top-level await
  const { awardPointsOnchain } = await import("../src/lib/solana/missionCpi");

  console.log("🚀 Awarding points on-chain");
  console.log("Wallet:", wallet);
  console.log("Amount:", amount);

  const res = await awardPointsOnchain({
    owner: wallet,
    amount,
    meta: {
      admin: "local-award-script",
      ts: Date.now(),
    },
  });

  if (!res?.ok) {
    console.error("❌ Onchain failed:", res?.error || "unknown_error");
    process.exit(1);
  }

  console.log("✅ Onchain success");
  console.log("TX:", res.tx);
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(1);
});
