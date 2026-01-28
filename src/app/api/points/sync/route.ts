// src/app/api/points/sync/route.ts
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/requireAdmin";
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

function asInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
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
async function memSet(key: string, val: any) {
  getMemDB().kv.set(key, val);
}
async function memHGetAll(key: string) {
  const v = await memGet(key);
  return v && typeof v === "object" ? v : {};
}
async function memHSet(key: string, patch: Record<string, any>) {
  const cur = await memHGetAll(key);
  const next = { ...cur, ...patch };
  await memSet(key, next);
  return next;
}

async function kvClient() {
  return getRedis();
}

async function redisHGetAllCompat(redis: any, key: string) {
  if (typeof redis.hGetAll === "function") {
    const obj = await redis.hGetAll(key);
    return obj && typeof obj === "object" ? obj : {};
  }
  const raw = await redis.get(key);
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function redisHSetPatchCompat(redis: any, key: string, patch: Record<string, any>) {
  if (typeof redis.hSet === "function") {
    await redis.hSet(key, patch);
    return;
  }
  const cur = await redisHGetAllCompat(redis, key);
  const next = { ...cur, ...patch };
  await redis.set(key, JSON.stringify(next));
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, 401);

  try {
    const { searchParams } = new URL(req.url);
    const wallet = String(searchParams.get("wallet") || "").trim();
    const dryRun = String(searchParams.get("dry") || "").trim() === "1";

    if (!wallet) return noStoreJson({ ok: false, error: "missing wallet" }, 400);

    // 1) 读链上 points
    const on = await fetchPointsAccount(wallet);

    if (!on?.exists) {
      return noStoreJson({
        ok: true,
        wallet,
        driver: pickDriver(),
        didSync: false,
        reason: "onchain_points_account_not_found",
        onchain: on ?? null,
      });
    }

    // 兼容不同 reader 返回格式：优先 on.raw.total_points，再 fallback on.total
    const onchainTotal = asInt(on?.raw?.total_points ?? on?.total ?? 0, 0);

    const driver = pickDriver();
    const now = Date.now();

    const kProfile = `u:${wallet}:profile`;
    const kOldPoints = `u:${wallet}:points`;

    // 2) 读 offchain 当前值
    let offchainBefore = 0;

    if (driver === "kv") {
      const redis: any = await kvClient();
      const prof = await redisHGetAllCompat(redis, kProfile);
      offchainBefore = asInt(prof?.points_total ?? 0, 0);

      if (!dryRun) {
        // 覆盖 profile.points_total
        await redisHSetPatchCompat(redis, kProfile, {
          points_total: onchainTotal,
          updatedAt: now,
        });

        // legacy key 同步一下（防止老逻辑读到旧值）
        await redis.set(kOldPoints, String(onchainTotal));

        // leaderboard 同步（all + legacy）
        if (typeof redis.zAdd === "function") {
          await redis.zAdd("leaderboard:points:all", [{ score: onchainTotal, value: wallet }]);
          await redis.zAdd("leaderboard:points", [{ score: onchainTotal, value: wallet }]);
        }
      }
    } else {
      const prof = await memHGetAll(kProfile);
      offchainBefore = asInt(prof?.points_total ?? 0, 0);

      if (!dryRun) {
        await memHSet(kProfile, {
          points_total: onchainTotal,
          updatedAt: now,
        });
        await memSet(kOldPoints, onchainTotal);
      }
    }

    const offchainAfter = dryRun ? offchainBefore : onchainTotal;

    return noStoreJson({
      ok: true,
      driver,
      wallet,
      dryRun,
      didSync: !dryRun,
      admin: auth.wallet,
      onchain: {
        exists: true,
        total_points: String(onchainTotal),
        raw: on?.raw ?? null,
      },
      offchain: {
        before: offchainBefore,
        after: offchainAfter,
      },
      sync: {
        isSynced: offchainAfter === onchainTotal,
        delta: offchainAfter - onchainTotal, // after - onchain
      },
    });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: String(e?.message || e) }, 500);
  }
}
