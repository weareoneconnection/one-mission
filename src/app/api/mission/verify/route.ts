import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { mockMissions } from "@/lib/mission/mock";
import { verifyOnchainMission } from "@/lib/onchain/verifyOnchain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Driver = "memory" | "kv";

type VerifyBody = {
  missionId?: string;
  id?: string;

  wallet?: string;
  walletAddress?: string;
  address?: string;

  points?: number;
  basePoints?: number;

  proof?: string;
  url?: string;
  note?: string;
};

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

// --------------------
// Period helpers (UTC, 与你 UI 文案一致)
// --------------------
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayKeyUTC(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function isoWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}
function asInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}
function parseMission(missionIdRaw: string) {
  const m = missionIdRaw.trim();
  const idx = m.indexOf(":");
  if (idx > 0) {
    const p = m.slice(0, idx).toLowerCase();
    if (p === "daily" || p === "weekly" || p === "once") {
      return { period: p as "daily" | "weekly" | "once", key: m.slice(idx + 1) || "default", id: m };
    }
  }
  return { period: "once" as const, key: m || "default", id: m || "once:default" };
}
function periodKeyForUTC(period: "once" | "daily" | "weekly") {
  if (period === "daily") return todayKeyUTC();
  if (period === "weekly") return isoWeekKeyUTC();
  return "once";
}

// --------------------
// memory store (dev)
// --------------------
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
async function memLPush(key: string, val: any) {
  const cur = (await memGet(key)) ?? [];
  const arr = Array.isArray(cur) ? cur : [];
  arr.unshift(val);
  await memSet(key, arr.slice(0, 2000));
  return arr.length;
}

// --------------------
// kv driver (prod)
// --------------------
async function kvClient() {
  return getRedis();
}

async function redisGetInt(redis: any, key: string) {
  const v = await redis.get(key);
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
async function redisHGetInt(redis: any, key: string, field: string) {
  if (typeof redis.hGet === "function") {
    const v = await redis.hGet(key, field);
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  const raw = await redis.get(key);
  if (!raw) return 0;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const n = Number(parsed?.[field] ?? 0);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  } catch {
    return 0;
  }
}
async function redisHSetPatch(redis: any, key: string, patch: Record<string, any>) {
  if (typeof redis.hSet === "function") {
    await redis.hSet(key, patch);
    return;
  }
  const curRaw = await redis.get(key);
  let cur: any = {};
  try {
    cur = curRaw ? JSON.parse(curRaw) : {};
  } catch {}
  await redis.set(key, JSON.stringify({ ...cur, ...patch }));
}

function streakNext(lastDate: string, today: string, curCount: number) {
  if (lastDate === today) return { count: curCount, lastDate };

  const t = new Date(today + "T00:00:00Z");
  const y = new Date(t.getTime() - 86400000);
  const yesterday = `${y.getUTCFullYear()}-${pad2(y.getUTCMonth() + 1)}-${pad2(y.getUTCDate())}`;

  const nextCount = lastDate === yesterday ? Math.max(1, curCount + 1) : 1;
  return { count: nextCount, lastDate: today };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as VerifyBody;

    const missionIdRaw = String(body.missionId || body.id || "").trim();
    const wallet = String(body.wallet || body.walletAddress || body.address || "").trim();

    if (!missionIdRaw) {
      return NextResponse.json({ ok: false, error: "missing missionId (missionId/id)" }, { status: 400 });
    }
    if (!wallet) {
      return NextResponse.json({ ok: false, error: "missing wallet (wallet/walletAddress/address)" }, { status: 400 });
    }

    // ✅ 任务必须以服务端任务表为准
    const mParsed = parseMission(missionIdRaw);
    const mission = mockMissions.find((x) => x.id === missionIdRaw || x.id === mParsed.id);
    if (!mission) {
      return NextResponse.json({ ok: false, error: "unknown missionId" }, { status: 400 });
    }

    const driver = pickDriver();

    // period aware
    const m = parseMission(mission.id);
    const pKey = periodKeyForUTC(m.period);

    const claimKey = `claim:${wallet}:${m.id}:${pKey}`;
    const uniqueKey = `unique:${wallet}:${m.id}`;

    // v2 keys
    const kProfile = `u:${wallet}:profile`;
    const kLedger = `ledger:${wallet}`;
    const kPToday = `u:${wallet}:points:daily:${todayKeyUTC()}`;
    const kPWeek = `u:${wallet}:points:weekly:${isoWeekKeyUTC()}`;

    // legacy
    const kOldDone = `mission:${mission.id}:${wallet}`;
    const kOldPoints = `u:${wallet}:points`;
    const kOldCompleted = `u:${wallet}:completed`;

    // ✅ pending submissions queue keys
    const submitKey = `submit:${wallet}:${m.id}:${pKey}`;
    const pendingListKey = `submissions:pending`;

    // ===========
    // 0) 非链上任务：进入 pending（不加分）
    // ===========
    if (mission.verifyType !== "wallet") {
      const now = Date.now();

      const existed =
        driver === "kv" ? await (await kvClient()).get(submitKey) : await memGet(submitKey);

      if (!existed) {
        const submissionId = `sub:${wallet}:${m.id}:${pKey}`;
        const points = Math.max(0, asInt(mission.basePoints, 0));

        const entry = {
          submissionId,
          ts: now,
          wallet,
          missionId: m.id,
          period: m.period,
          periodKey: pKey,
          points, // ✅ admin 审核用
          status: "pending",
          proof: String(body.proof || body.url || body.note || "").slice(0, 2000),
        };

        if (driver === "kv") {
          const redis = await kvClient();
          await redis.set(submitKey, "1");
          if (m.period === "daily") await redis.expire(submitKey, 86400 * 14);
          if (m.period === "weekly") await redis.expire(submitKey, 86400 * 60);
          if (m.period === "once") await redis.expire(submitKey, 86400 * 365);

          if (typeof redis.lPush === "function") {
            await redis.lPush(pendingListKey, JSON.stringify(entry));
            if (typeof redis.lTrim === "function") await redis.lTrim(pendingListKey, 0, 1999);
          } else {
            const raw = await redis.get(pendingListKey);
            let arr: any[] = [];
            try {
              arr = raw ? JSON.parse(raw) : [];
            } catch {}
            arr.unshift(entry);
            arr = arr.slice(0, 2000);
            await redis.set(pendingListKey, JSON.stringify(arr));
          }
        } else {
          await memSet(submitKey, true);
          await memLPush(pendingListKey, entry);
        }
      }

      return NextResponse.json({
        ok: true,
        pending: true,
        missionId: m.id,
        wallet,
        period: m.period,
        periodKey: pKey,
        message: "Submitted for review. Points will be granted after approval.",
        driver,
      });
    }

    // ===========
    // 1) Dedup by period claim（链上任务）
    // ===========
    const already =
      driver === "kv" ? await (await kvClient()).get(claimKey) : await memGet(claimKey);

    if (already) {
      if (driver === "kv") {
        const redis = await kvClient();
        const totalPoints =
          (await redisHGetInt(redis, kProfile, "points_total")) || (await redisGetInt(redis, kOldPoints));
        const completed =
          (await redisHGetInt(redis, kProfile, "completed_total")) || (await redisGetInt(redis, kOldCompleted));
        const uniqueCompleted = await redisHGetInt(redis, kProfile, "unique_once_total");
        const streakCount = await redisHGetInt(redis, kProfile, "streak_count");
        const streakLast = (await redis.hGet?.(kProfile, "streak_last_date")) ?? "";

        return NextResponse.json({
          ok: true,
          verified: true,
          alreadyVerified: true,
          missionId: m.id,
          wallet,
          period: m.period,
          periodKey: pKey,
          pointsAdded: 0,
          totalPoints,
          completed,
          completedMeaning: "total_claims",
          uniqueCompleted,
          uniqueMeaning: "unique_once",
          streak: { count: streakCount, lastDate: String(streakLast || ""), active: String(streakLast || "") === todayKeyUTC() },
          driver,
        });
      } else {
        // memory 分支略（你线上走 kv）
        return NextResponse.json({ ok: true, verified: true, alreadyVerified: true, driver });
      }
    }

    // ===========
    // 2) 服务器端链上校验
    // ===========
    if (mission.verifyType === "wallet" && mission.onchain) {
      const res = await verifyOnchainMission(mission as any, wallet);
      if (!res?.ok) {
        return NextResponse.json({ ok: false, error: res?.reason ?? "onchain_verification_failed" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "wallet mission missing onchain requirement" }, { status: 400 });
    }

    // ===========
    // 3) Apply claim + ledger + streak + leaderboards + unique
    // ===========
    const now = Date.now();
    const today = todayKeyUTC();
    const week = isoWeekKeyUTC();

    const add = Math.max(0, asInt(mission.basePoints, 0));

    if (driver === "kv") {
      const redis = await kvClient();

      await redis.set(claimKey, "1");
      if (m.period === "daily") await redis.expire(claimKey, 86400 * 8);
      if (m.period === "weekly") await redis.expire(claimKey, 86400 * 60);

      if (m.period === "once") await redis.set(kOldDone, "1");

      const curTotal =
        (await redisHGetInt(redis, kProfile, "points_total")) || (await redisGetInt(redis, kOldPoints));
      const curClaims =
        (await redisHGetInt(redis, kProfile, "completed_total")) || (await redisGetInt(redis, kOldCompleted));
      const curUniqueOnce = await redisHGetInt(redis, kProfile, "unique_once_total");

      const curStreak = await redisHGetInt(redis, kProfile, "streak_count");
      const curLast = (await redis.hGet?.(kProfile, "streak_last_date")) ?? "";

      const shouldCountStreak = m.period === "daily";
      const nextStreak = shouldCountStreak
        ? streakNext(String(curLast || ""), today, curStreak)
        : { count: curStreak, lastDate: String(curLast || "") };

      const nextTotal = curTotal + add;
      const nextClaims = curClaims + 1;

      let didCountUnique = false;
      let nextUniqueOnce = curUniqueOnce;
      if (m.period === "once") {
        const existed = await redis.get(uniqueKey);
        if (!existed) {
          await redis.set(uniqueKey, "1");
          didCountUnique = true;
          nextUniqueOnce = curUniqueOnce + 1;
        }
      }

      await redisHSetPatch(redis, kProfile, {
        points_total: nextTotal,
        completed_total: nextClaims,
        unique_once_total: nextUniqueOnce,
        streak_count: nextStreak.count,
        streak_last_date: nextStreak.lastDate,
        updatedAt: now,
      });

      if (add > 0) {
        if (m.period === "daily") await redis.incrBy(kPToday, add);
        else if (m.period === "weekly") await redis.incrBy(kPWeek, add);
      }

      if (add > 0) await redis.incrBy(kOldPoints, add);
      await redis.incr(kOldCompleted);

      await redis.zAdd("leaderboard:points:all", [{ score: nextTotal, value: wallet }]);
      await redis.zAdd("leaderboard:completed:all", [{ score: nextClaims, value: wallet }]);
      await redis.zAdd("leaderboard:unique:once:all", [{ score: nextUniqueOnce, value: wallet }]);

      if (m.period === "daily") {
        const dayPoints = await redisGetInt(redis, kPToday);
        await redis.zAdd(`leaderboard:points:daily:${today}`, [{ score: dayPoints, value: wallet }]);
      }
      if (m.period === "weekly") {
        const weekPoints = await redisGetInt(redis, kPWeek);
        await redis.zAdd(`leaderboard:points:weekly:${week}`, [{ score: weekPoints, value: wallet }]);
      }

      await redis.zAdd("leaderboard:points", [{ score: nextTotal, value: wallet }]);
      await redis.zAdd("leaderboard:completed", [{ score: nextClaims, value: wallet }]);

      const entry = { ts: now, wallet, missionId: m.id, period: m.period, periodKey: pKey, amount: add, reason: "mission_claim", uniqueCounted: didCountUnique ? 1 : 0 };

      if (typeof redis.lPush === "function") {
        await redis.lPush(kLedger, JSON.stringify(entry));
        if (typeof redis.lTrim === "function") await redis.lTrim(kLedger, 0, 999);
      } else {
        const raw = await redis.get(kLedger);
        let arr: any[] = [];
        try {
          arr = raw ? JSON.parse(raw) : [];
        } catch {}
        arr.unshift(entry);
        arr = arr.slice(0, 1000);
        await redis.set(kLedger, JSON.stringify(arr));
      }

      return NextResponse.json({
        ok: true,
        verified: true,
        missionId: m.id,
        wallet,
        period: m.period,
        periodKey: pKey,
        pointsAdded: add,
        totalPoints: nextTotal,
        completed: nextClaims,
        completedMeaning: "total_claims",
        uniqueCompleted: nextUniqueOnce,
        uniqueMeaning: "unique_once",
        uniqueCountedThisTime: didCountUnique,
        streak: { count: nextStreak.count, lastDate: nextStreak.lastDate, active: nextStreak.lastDate === today },
        driver,
      });
    }

    return NextResponse.json({ ok: false, error: "memory driver not implemented here" }, { status: 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "verify_error" }, { status: 500 });
  }
}
