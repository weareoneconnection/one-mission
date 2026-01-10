import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

type Driver = "memory" | "kv";

type VerifyBody = {
  missionId?: string;
  id?: string;

  wallet?: string;
  walletAddress?: string;
  address?: string;

  points?: number;
  basePoints?: number;
};

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

// --------------------
// Period helpers
// --------------------
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
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
  // allow: "daily:checkin", "weekly:vote", "once:join"
  // fallback: treat as once
  const m = missionIdRaw.trim();
  const idx = m.indexOf(":");
  if (idx > 0) {
    const p = m.slice(0, idx).toLowerCase();
    if (p === "daily" || p === "weekly" || p === "once") {
      return {
        period: p as "daily" | "weekly" | "once",
        key: m.slice(idx + 1) || "default",
        id: m,
      };
    }
  }
  return { period: "once" as const, key: m || "default", id: m || "once:default" };
}

function periodKeyFor(period: "once" | "daily" | "weekly") {
  if (period === "daily") return todayKey();
  if (period === "weekly") return isoWeekKey();
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
async function memIncrBy(key: string, n: number) {
  const cur = Number(getMemDB().kv.get(key) ?? 0);
  const next = cur + n;
  getMemDB().kv.set(key, next);
  return next;
}
async function memIncr(key: string) {
  return memIncrBy(key, 1);
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
async function memLPush(key: string, val: any) {
  const cur = (await memGet(key)) ?? [];
  const arr = Array.isArray(cur) ? cur : [];
  arr.unshift(val);
  await memSet(key, arr.slice(0, 200));
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
  const next = { ...cur, ...patch };
  await redis.set(key, JSON.stringify(next));
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
    const points = asInt(body.points ?? body.basePoints, 0);

    if (!missionIdRaw) {
      return NextResponse.json(
        { ok: false, error: "missing missionId (missionId/id)" },
        { status: 400 }
      );
    }
    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "missing wallet (wallet/walletAddress/address)" },
        { status: 400 }
      );
    }

    const driver = pickDriver();

    // Parse mission -> period aware
    const m = parseMission(missionIdRaw);
    const pKey = periodKeyFor(m.period);
    const claimKey = `claim:${wallet}:${m.id}:${pKey}`;

    // ✅ NEW: unique key (only meaningful for once missions)
    const uniqueKey = `unique:${wallet}:${m.id}`;

    // v2 keys
    const kProfile = `u:${wallet}:profile`; // hash
    const kLedger = `ledger:${wallet}`;     // list
    const kPToday = `u:${wallet}:points:daily:${todayKey()}`;
    const kPWeek = `u:${wallet}:points:weekly:${isoWeekKey()}`;

    // v1 legacy keys for compatibility
    const kOldDone = `mission:${missionIdRaw}:${wallet}`;
    const kOldPoints = `u:${wallet}:points`;
    const kOldCompleted = `u:${wallet}:completed`;

    // ---------
    // 1) Dedup by period claim
    // ---------
    const already =
      driver === "kv"
        ? await (await kvClient()).get(claimKey)
        : await memGet(claimKey);

    if (already) {
      if (driver === "kv") {
        const redis = await kvClient();
        const totalPoints =
          (await redisHGetInt(redis, kProfile, "points_total")) ||
          (await redisGetInt(redis, kOldPoints));

        // ✅ completed_total 继续代表 claims（兼容老前端）
        const completed =
          (await redisHGetInt(redis, kProfile, "completed_total")) ||
          (await redisGetInt(redis, kOldCompleted));

        // ✅ 新增 unique（只统计 once 的唯一完成数）
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
          streak: {
            count: streakCount,
            lastDate: String(streakLast || ""),
            active: String(streakLast || "") === todayKey(),
          },
          driver,
        });
      } else {
        const prof = await memHGetAll(kProfile);
        const totalPoints = asInt(prof.points_total ?? (await memGet(kOldPoints)), 0);
        const completed = asInt(prof.completed_total ?? (await memGet(kOldCompleted)), 0);
        const uniqueCompleted = asInt(prof.unique_once_total, 0);

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
          streak: {
            count: asInt(prof.streak_count, 0),
            lastDate: String(prof.streak_last_date || ""),
            active: String(prof.streak_last_date || "") === todayKey(),
          },
          driver,
        });
      }
    }

    // ---------
    // 2) Apply claim + ledger + streak + leaderboards + unique
    // ---------
    const now = Date.now();
    const today = todayKey();
    const week = isoWeekKey();

    if (driver === "kv") {
      const redis = await kvClient();

      // claim mark
      await redis.set(claimKey, "1");

      // ✅ TTL for claimKey (prevent growth)
      if (m.period === "daily") await redis.expire(claimKey, 86400 * 8);
      if (m.period === "weekly") await redis.expire(claimKey, 86400 * 60);

      // ✅ legacy done only for once
      if (m.period === "once") {
        await redis.set(kOldDone, "1");
      }

      // read current profile totals (fallback legacy)
      const curTotal =
        (await redisHGetInt(redis, kProfile, "points_total")) ||
        (await redisGetInt(redis, kOldPoints));

      const curClaims =
        (await redisHGetInt(redis, kProfile, "completed_total")) ||
        (await redisGetInt(redis, kOldCompleted));

      const curUniqueOnce = await redisHGetInt(redis, kProfile, "unique_once_total");

      const curStreak = await redisHGetInt(redis, kProfile, "streak_count");
      const curLast = (await redis.hGet?.(kProfile, "streak_last_date")) ?? "";

      // streak counts only on DAILY missions
      const shouldCountStreak = m.period === "daily";
      const nextStreak = shouldCountStreak
        ? streakNext(String(curLast || ""), today, curStreak)
        : { count: curStreak, lastDate: String(curLast || "") };

      const add = Math.max(0, points);
      const nextTotal = curTotal + add;

      // ✅ claims always +1 for every successful claim
      const nextClaims = curClaims + 1;

      // ✅ unique logic: only for once missions, first time ever
      let didCountUnique = false;
      let nextUniqueOnce = curUniqueOnce;

      if (m.period === "once") {
        const existed = await redis.get(uniqueKey);
        if (!existed) {
          await redis.set(uniqueKey, "1"); // no ttl (unique forever)
          didCountUnique = true;
          nextUniqueOnce = curUniqueOnce + 1;
        }
      }

      // update profile
      await redisHSetPatch(redis, kProfile, {
        points_total: nextTotal,
        completed_total: nextClaims, // ✅ still claims (compat)
        unique_once_total: nextUniqueOnce, // ✅ new
        streak_count: nextStreak.count,
        streak_last_date: nextStreak.lastDate,
        updatedAt: now,
      });

      // period points
      if (add > 0) {
        if (m.period === "daily") await redis.incrBy(kPToday, add);
        else if (m.period === "weekly") await redis.incrBy(kPWeek, add);
      }

      // legacy totals
      if (add > 0) await redis.incrBy(kOldPoints, add);
      await redis.incr(kOldCompleted); // legacy completed = claims

      // Leaderboards (v2)
      await redis.zAdd("leaderboard:points:all", [{ score: nextTotal, value: wallet }]);
      await redis.zAdd("leaderboard:completed:all", [{ score: nextClaims, value: wallet }]);
      await redis.zAdd("leaderboard:unique:once:all", [{ score: nextUniqueOnce, value: wallet }]); // ✅ new optional board

      if (m.period === "daily") {
        const dayPoints = await redisGetInt(redis, kPToday);
        await redis.zAdd(`leaderboard:points:daily:${today}`, [{ score: dayPoints, value: wallet }]);
      }
      if (m.period === "weekly") {
        const weekPoints = await redisGetInt(redis, kPWeek);
        await redis.zAdd(`leaderboard:points:weekly:${week}`, [{ score: weekPoints, value: wallet }]);
      }

      // legacy leaderboards (v1)
      await redis.zAdd("leaderboard:points", [{ score: nextTotal, value: wallet }]);
      await redis.zAdd("leaderboard:completed", [{ score: nextClaims, value: wallet }]);

      // ledger record
      const entry = {
        ts: now,
        wallet,
        missionId: m.id,
        period: m.period,
        periodKey: pKey,
        amount: add,
        reason: "mission_claim",
        uniqueCounted: didCountUnique ? 1 : 0,
      };

      if (typeof redis.lPush === "function") {
        await redis.lPush(kLedger, JSON.stringify(entry));
        if (typeof redis.lTrim === "function") await redis.lTrim(kLedger, 0, 199);
      } else {
        const raw = await redis.get(kLedger);
        let arr: any[] = [];
        try {
          arr = raw ? JSON.parse(raw) : [];
        } catch {}
        arr.unshift(entry);
        arr = arr.slice(0, 200);
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
        streak: {
          count: nextStreak.count,
          lastDate: nextStreak.lastDate,
          active: nextStreak.lastDate === today,
        },
        driver,
      });
    } else {
      // -------- memory driver (dev) --------
      await memSet(claimKey, true);

      // legacy done only for once
      if (m.period === "once") {
        await memSet(kOldDone, true);
      }

      const prof = await memHGetAll(kProfile);

      const curTotal = asInt(prof.points_total ?? (await memGet(kOldPoints)), 0);
      const curClaims = asInt(prof.completed_total ?? (await memGet(kOldCompleted)), 0);
      const curUniqueOnce = asInt(prof.unique_once_total, 0);

      const curStreak = asInt(prof.streak_count, 0);
      const curLast = String(prof.streak_last_date || "");

      const add = Math.max(0, points);
      const nextTotal = curTotal + add;
      const nextClaims = curClaims + 1;

      let didCountUnique = false;
      let nextUniqueOnce = curUniqueOnce;

      if (m.period === "once") {
        const existed = await memGet(uniqueKey);
        if (!existed) {
          await memSet(uniqueKey, true);
          didCountUnique = true;
          nextUniqueOnce = curUniqueOnce + 1;
        }
      }

      const shouldCountStreak = m.period === "daily";
      const nextStreak = shouldCountStreak
        ? streakNext(curLast, today, curStreak)
        : { count: curStreak, lastDate: curLast };

      await memHSet(kProfile, {
        points_total: nextTotal,
        completed_total: nextClaims,      // claims
        unique_once_total: nextUniqueOnce, // new
        streak_count: nextStreak.count,
        streak_last_date: nextStreak.lastDate,
        updatedAt: now,
      });

      // period points
      if (add > 0) {
        if (m.period === "daily") await memIncrBy(kPToday, add);
        if (m.period === "weekly") await memIncrBy(kPWeek, add);
      }

      // legacy totals
      if (add > 0) await memIncrBy(kOldPoints, add);
      await memIncr(kOldCompleted);

      // ledger
      await memLPush(kLedger, {
        ts: now,
        wallet,
        missionId: m.id,
        period: m.period,
        periodKey: pKey,
        amount: add,
        reason: "mission_claim",
        uniqueCounted: didCountUnique ? 1 : 0,
      });

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
        streak: {
          count: nextStreak.count,
          lastDate: nextStreak.lastDate,
          active: nextStreak.lastDate === today,
        },
        driver,
      });
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "verify_error" },
      { status: 500 }
    );
  }
}
