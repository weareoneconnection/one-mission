// src/app/api/role/route.ts
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { fetchPointsAccount } from "@/lib/solana/pointsReader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Driver = "memory" | "kv";

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function asInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function envInt(name: string, fallback: number) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeWallet(w: string) {
  return String(w || "").trim();
}

function parseWalletList(v?: string) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdminWallet(wallet: string) {
  const w = wallet.trim();
  if (!w) return false;

  const single = String(process.env.ADMIN_WALLET || "").trim();
  if (single && single === w) return true;

  const list = parseWalletList(process.env.WAOC_ADMIN_WALLETS);
  if (list.length && list.includes(w)) return true;

  return false;
}

// -------------------- memory store (dev) --------------------
type MemDB = { kv: Map<string, any> };
function getMemDB(): MemDB {
  const g = globalThis as unknown as { __ONE_MISSION_MEMDB__?: MemDB };
  if (!g.__ONE_MISSION_MEMDB__) g.__ONE_MISSION_MEMDB__ = { kv: new Map() };
  return g.__ONE_MISSION_MEMDB__;
}
async function memGet(key: string) {
  return getMemDB().kv.get(key);
}
async function memHGetAll(key: string) {
  const v = await memGet(key);
  return v && typeof v === "object" ? v : {};
}

async function readProfileKV(redis: any, key: string) {
  // 兼容：你之前写过 hSet / JSON fallback
  if (typeof redis.hGetAll === "function") {
    const obj = await redis.hGetAll(key);
    return obj && typeof obj === "object" ? obj : {};
  }
  const raw = await redis.get(key);
  if (!raw) return {};
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function computeRoles(args: {
  wallet: string;
  offchainTotal: number;
  offchainCompleted: number;
  offchainUniqueOnce: number;
  onchainTotal?: number | null;
}) {
  // ✅ 阈值（可用 env 覆盖）
  // 你也可以后续把它做成配置表/治理参数
  const OG_POINTS = envInt("WAOC_ROLE_OG_POINTS", 500);
  const CONTRIBUTOR_POINTS = envInt("WAOC_ROLE_CONTRIBUTOR_POINTS", 1000);
  const GUARDIAN_POINTS = envInt("WAOC_ROLE_GUARDIAN_POINTS", 3000);

  // ✅ 额外条件（可选）
  const OG_UNIQUE_ONCE = envInt("WAOC_ROLE_OG_UNIQUE_ONCE", 1); // 做过至少 1 次 once 任务
  const CONTRIBUTOR_COMPLETED = envInt("WAOC_ROLE_CONTRIBUTOR_COMPLETED", 10);
  const GUARDIAN_COMPLETED = envInt("WAOC_ROLE_GUARDIAN_COMPLETED", 30);

  const roles: Array<"OG" | "Contributor" | "Guardian" | "Admin"> = [];
  const reasons: Record<string, any> = {};

  // Admin
  if (isAdminWallet(args.wallet)) {
    roles.push("Admin");
    reasons.Admin = { rule: "wallet_whitelist", ok: true };
  }

  // OG
  const ogOk =
    args.offchainTotal >= OG_POINTS && args.offchainUniqueOnce >= OG_UNIQUE_ONCE;
  if (ogOk) {
    roles.push("OG");
    reasons.OG = {
      points_total: { got: args.offchainTotal, need: OG_POINTS },
      unique_once_total: { got: args.offchainUniqueOnce, need: OG_UNIQUE_ONCE },
    };
  }

  // Contributor
  const contributorOk =
    args.offchainTotal >= CONTRIBUTOR_POINTS &&
    args.offchainCompleted >= CONTRIBUTOR_COMPLETED;
  if (contributorOk) {
    roles.push("Contributor");
    reasons.Contributor = {
      points_total: { got: args.offchainTotal, need: CONTRIBUTOR_POINTS },
      completed_total: { got: args.offchainCompleted, need: CONTRIBUTOR_COMPLETED },
    };
  }

  // Guardian
  const guardianOk =
    args.offchainTotal >= GUARDIAN_POINTS &&
    args.offchainCompleted >= GUARDIAN_COMPLETED;
  if (guardianOk) {
    roles.push("Guardian");
    reasons.Guardian = {
      points_total: { got: args.offchainTotal, need: GUARDIAN_POINTS },
      completed_total: { got: args.offchainCompleted, need: GUARDIAN_COMPLETED },
    };
  }

  // ✅ 计算 Level（最简单可解释的版本）
  // 你后面可以换成更细的 curve / 权利系统
  const pts = args.offchainTotal;
  let level = 0;
  if (pts >= 50) level = 1;
  if (pts >= 200) level = 2;
  if (pts >= 500) level = 3;
  if (pts >= 1000) level = 4;
  if (pts >= 3000) level = 5;
  if (pts >= 8000) level = 6;

  // ✅ onchain 对齐状态（路线 A）
  const on = args.onchainTotal ?? null;
  const isSynced = on == null ? null : on === args.offchainTotal;
  const delta = on == null ? null : args.offchainTotal - on;

  return {
    wallet: args.wallet,
    roles,
    level,
    offchain: {
      points_total: args.offchainTotal,
      completed_total: args.offchainCompleted,
      unique_once_total: args.offchainUniqueOnce,
    },
    onchain: {
      total_points: on,
    },
    sync: {
      isSynced,
      delta, // offchain - onchain
    },
    thresholds: {
      OG_POINTS,
      CONTRIBUTOR_POINTS,
      GUARDIAN_POINTS,
      OG_UNIQUE_ONCE,
      CONTRIBUTOR_COMPLETED,
      GUARDIAN_COMPLETED,
    },
    reasons,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = normalizeWallet(String(searchParams.get("wallet") || ""));
    if (!wallet) return noStoreJson({ ok: false, error: "missing wallet" }, 400);

    const driver = pickDriver();

    // 1) 读 offchain profile（你的 approve 已经维护 u:${wallet}:profile）
    const kProfile = `u:${wallet}:profile`;

    let prof: any = {};
    if (driver === "kv") {
      const redis: any = await getRedis();
      prof = await readProfileKV(redis, kProfile);
    } else {
      prof = await memHGetAll(kProfile);
    }

    // 兼容：可能是 string
    const offchainTotal = asInt(prof?.points_total ?? prof?.pointsTotal ?? 0, 0);
    const offchainCompleted = asInt(prof?.completed_total ?? prof?.completedTotal ?? 0, 0);
    const offchainUniqueOnce = asInt(prof?.unique_once_total ?? prof?.uniqueOnceTotal ?? 0, 0);

    // 2) 尝试读链上 points（失败不影响角色返回）
    let onchainTotal: number | null = null;
    try {
      const r = await fetchPointsAccount(wallet);
      if (r?.exists) {
        // pointsReader 通常会返回 total（string 或 number）
        const t = (r as any)?.total ?? (r as any)?.raw?.total_points ?? null;
        onchainTotal = t == null ? null : asInt(t, 0);
      }
    } catch {
      // ignore
    }

    const data = computeRoles({
      wallet,
      offchainTotal,
      offchainCompleted,
      offchainUniqueOnce,
      onchainTotal,
    });

    return noStoreJson({ ok: true, driver, ...data });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: String(e?.message || e) }, 500);
  }
}
