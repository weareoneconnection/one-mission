// src/app/api/mission/approve/route.ts
import { awardPointsOnchain } from "@/lib/solana/missionCpi";
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { mockMissions } from "@/lib/mission/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Driver = "memory" | "kv";

type Body = {
  submissionId?: string;

  wallet?: string;
  missionId?: string;
  periodKey?: string;

  note?: string;
  points?: number; // admin override
};

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// ✅ 统一：UTC 日/周 key（和 leaderboard 完全一致）
function todayKeyUTC(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function isoWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thu
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
      return { period: p as "daily" | "weekly" | "once", id: m };
    }
  }
  return { period: "once" as const, id: m || "once:default" };
}

function periodKeyForUTC(period: "once" | "daily" | "weekly") {
  if (period === "daily") return todayKeyUTC();
  if (period === "weekly") return isoWeekKeyUTC();
  return "once";
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
async function memLPush(key: string, val: any, maxLen = 200) {
  const cur = (await memGet(key)) ?? [];
  const arr = Array.isArray(cur) ? cur : [];
  arr.unshift(val);
  await memSet(key, arr.slice(0, maxLen));
}

// -------------------- kv helpers --------------------
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
async function redisHIncrByCompat(redis: any, key: string, field: string, delta: number) {
  if (typeof redis.hIncrBy === "function") {
    const v = await redis.hIncrBy(key, field, delta);
    return asInt(v, 0);
  }
  const cur = await redisHGetInt(redis, key, field);
  const next = cur + delta;
  await redisHSetPatch(redis, key, { [field]: next });
  return next;
}

function streakNextUTC(lastDate: string, today: string, curCount: number) {
  if (lastDate === today) return { count: curCount, lastDate };
  const t = new Date(today + "T00:00:00Z");
  const y = new Date(t.getTime() - 86400000);
  const yesterday = `${y.getUTCFullYear()}-${pad2(y.getUTCMonth() + 1)}-${pad2(y.getUTCDate())}`;
  const nextCount = lastDate === yesterday ? Math.max(1, curCount + 1) : 1;
  return { count: nextCount, lastDate: today };
}

// -------------------- pending helpers --------------------
function safeParse(s: any) {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

/**
 * ✅ 优化点：
 * - 先扫前 N 条（你 UI 只 load 50，approve 基本都在前 50）
 * - 仅当没命中才扩大范围
 * - 先用字符串包含判断 submissionId，命中才 JSON.parse（减少 CPU）
 */
async function kvFindAndRemovePendingBySubmissionId(redis: any, submissionId: string) {
  const kPending = "submissions:pending";
  const kApproved = "submissions:approved";

  const scan = async (end: number) => {
    const raw: string[] = typeof redis.lRange === "function" ? await redis.lRange(kPending, 0, end) : [];
    if (!Array.isArray(raw) || raw.length === 0) return { foundRaw: null as any, foundObj: null as any, raw };
    const needle = `"submissionId":"${submissionId}"`;
    for (const s of raw) {
      if (typeof s === "string" && !s.includes(needle)) continue;
      const obj = safeParse(s);
      if (String(obj?.submissionId || "") === submissionId) {
        return { foundRaw: s, foundObj: obj, raw };
      }
    }
    return { foundRaw: null as any, foundObj: null as any, raw };
  };

  let r = await scan(399);
  if (!r.foundObj) r = await scan(1999);
  if (!r.foundObj) return { found: null as any };

  if (typeof redis.lRem === "function") await redis.lRem(kPending, 1, r.foundRaw);
  else {
    const keep = r.raw.filter((x) => x !== r.foundRaw);
    await redis.set(kPending, JSON.stringify(keep.map(safeParse)));
  }

  const approvedEntry = { ...r.foundObj, reviewedAt: Date.now(), status: "approved" };
  if (typeof redis.lPush === "function") {
    await redis.lPush(kApproved, JSON.stringify(approvedEntry));
    if (typeof redis.lTrim === "function") await redis.lTrim(kApproved, 0, 999);
  } else {
    const blob = await redis.get(kApproved);
    let arr: any[] = [];
    try {
      arr = blob ? JSON.parse(blob) : [];
    } catch {}
    arr.unshift(approvedEntry);
    arr = arr.slice(0, 1000);
    await redis.set(kApproved, JSON.stringify(arr));
  }

  return { found: r.foundObj };
}

async function kvFindAndRemovePendingByFields(redis: any, wallet: string, missionId: string, periodKey: string) {
  const kPending = "submissions:pending";
  const kApproved = "submissions:approved";

  const scan = async (end: number) => {
    const raw: string[] = typeof redis.lRange === "function" ? await redis.lRange(kPending, 0, end) : [];
    if (!Array.isArray(raw) || raw.length === 0) return { foundRaw: null as any, foundObj: null as any, raw };
    for (const s of raw) {
      const obj = safeParse(s);
      const w = String(obj?.wallet || "").trim();
      const mid = String(obj?.missionId || "").trim();
      const pk = String(obj?.periodKey || "").trim();
      if (w === wallet && mid === missionId && pk === periodKey) {
        return { foundRaw: s, foundObj: obj, raw };
      }
    }
    return { foundRaw: null as any, foundObj: null as any, raw };
  };

  let r = await scan(399);
  if (!r.foundObj) r = await scan(1999);
  if (!r.foundObj) return { found: null as any };

  if (typeof redis.lRem === "function") await redis.lRem(kPending, 1, r.foundRaw);
  else {
    const keep = r.raw.filter((x) => x !== r.foundRaw);
    await redis.set(kPending, JSON.stringify(keep.map(safeParse)));
  }

  const approvedEntry = { ...r.foundObj, reviewedAt: Date.now(), status: "approved" };
  if (typeof redis.lPush === "function") {
    await redis.lPush(kApproved, JSON.stringify(approvedEntry));
    if (typeof redis.lTrim === "function") await redis.lTrim(kApproved, 0, 999);
  } else {
    const blob = await redis.get(kApproved);
    let arr: any[] = [];
    try {
      arr = blob ? JSON.parse(blob) : [];
    } catch {}
    arr.unshift(approvedEntry);
    arr = arr.slice(0, 1000);
    await redis.set(kApproved, JSON.stringify(arr));
  }

  return { found: r.foundObj };
}

async function memFindAndRemovePendingBySubmissionId(submissionId: string) {
  const kPending = "submissions:pending";
  const kApproved = "submissions:approved";

  const list = ((await memGet(kPending)) ?? []) as any[];
  const arr = Array.isArray(list) ? list : [];
  const idx = arr.findIndex((x) => String(x?.submissionId || "") === submissionId);
  if (idx < 0) return { found: null as any };

  const found = arr[idx];
  const next = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
  await memSet(kPending, next);
  await memLPush(kApproved, { ...found, reviewedAt: Date.now(), status: "approved" }, 1000);
  return { found };
}

async function memFindAndRemovePendingByFields(wallet: string, missionId: string, periodKey: string) {
  const kPending = "submissions:pending";
  const kApproved = "submissions:approved";

  const list = ((await memGet(kPending)) ?? []) as any[];
  const arr = Array.isArray(list) ? list : [];
  const idx = arr.findIndex((x) => {
    const w = String(x?.wallet || "").trim();
    const mid = String(x?.missionId || "").trim();
    const pk = String(x?.periodKey || "").trim();
    return w === wallet && mid === missionId && pk === periodKey;
  });
  if (idx < 0) return { found: null as any };

  const found = arr[idx];
  const next = [...arr.slice(0, idx), ...arr.slice(idx + 1)];
  await memSet(kPending, next);
  await memLPush(kApproved, { ...found, reviewedAt: Date.now(), status: "approved" }, 1000);
  return { found };
}

function missionBasePoints(missionId: string) {
  const mm = mockMissions.find((x) => x.id === missionId);
  return Math.max(0, asInt(mm?.basePoints, 0));
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const driver = pickDriver();

    let wallet = String(body.wallet || "").trim();
    let missionIdRaw = String(body.missionId || "").trim();
    let periodKeyInput = String(body.periodKey || "").trim();

    let pointsFromSubmission = -1;
    let submission: any = null;

    const redis: any = driver === "kv" ? await kvClient() : null;

    // ✅ onchain 结果作用域（KV/memory 都能用）
    let onchain: any = null;

    // 1) submissionId 优先
    if (body.submissionId) {
      const sid = String(body.submissionId).trim();
      if (!sid) return noStoreJson({ ok: false, error: "missing submissionId" }, 400);

      if (driver === "kv") {
        const { found } = await kvFindAndRemovePendingBySubmissionId(redis, sid);
        submission = found;
      } else {
        const { found } = await memFindAndRemovePendingBySubmissionId(sid);
        submission = found;
      }

      if (submission) {
        wallet = String(submission.wallet || "").trim();
        missionIdRaw = String(submission.missionId || "").trim();
        periodKeyInput = String(submission.periodKey || "").trim();
        const p = asInt(submission.points, -1);
        pointsFromSubmission = p > 0 ? p : -1;
      }
    }

    if (!wallet) return noStoreJson({ ok: false, error: "missing wallet" }, 400);
    if (!missionIdRaw) return noStoreJson({ ok: false, error: "missing missionId" }, 400);

    const m0 = parseMission(missionIdRaw);
    const pKey0 = periodKeyInput || periodKeyForUTC(m0.period);

    // 2) fallback fields 删除 pending
    if (!submission) {
      if (driver === "kv") {
        const { found } = await kvFindAndRemovePendingByFields(redis, wallet, m0.id, pKey0);
        submission = found;
      } else {
        const { found } = await memFindAndRemovePendingByFields(wallet, m0.id, pKey0);
        submission = found;
      }
      if (submission) {
        wallet = String(submission.wallet || wallet).trim();
        missionIdRaw = String(submission.missionId || missionIdRaw).trim();
        periodKeyInput = String(submission.periodKey || pKey0).trim();
      }
    }

    const m = parseMission(missionIdRaw);
    const pKey = periodKeyInput || periodKeyForUTC(m.period);

    const overridePoints = asInt(body.points, -1);
    const base = missionBasePoints(m.id);
    if (submission) {
      const p = asInt(submission.points, -1);
      pointsFromSubmission = p > 0 ? p : pointsFromSubmission;
    }
    const add = Math.max(
      0,
      overridePoints > 0 ? overridePoints : pointsFromSubmission > 0 ? pointsFromSubmission : base
    );

    const claimKey = `claim:${wallet}:${m.id}:${pKey}`;
    const uniqueKey = `unique:${wallet}:${m.id}`;

    const kProfile = `u:${wallet}:profile`;
    const kLedger = `ledger:${wallet}`;

    const kPToday = `u:${wallet}:points:daily:${pKey}`;
    const kPWeek = `u:${wallet}:points:weekly:${pKey}`;

    const kOldDone = `mission:${missionIdRaw}:${wallet}`;
    const kOldPoints = `u:${wallet}:points`;
    const kOldCompleted = `u:${wallet}:completed`;

    const already = driver === "kv" ? await redis.get(claimKey) : await memGet(claimKey);
    if (already) {
      return noStoreJson({
        ok: true,
        alreadyApproved: true,
        wallet,
        missionId: m.id,
        period: m.period,
        periodKey: pKey,
        pointsAdded: 0,
        driver,
        onchain: null,
      });
    }

    const now = Date.now();

    // -------------------- KV driver --------------------
    if (driver === "kv") {
      await redis.set(claimKey, "1");
      if (m.period === "daily") await redis.expire(claimKey, 86400 * 8);
      if (m.period === "weekly") await redis.expire(claimKey, 86400 * 60);
      if (m.period === "once") await redis.set(kOldDone, "1");

      const curStreak = await redisHGetInt(redis, kProfile, "streak_count");
      const curLast = (await redis.hGet?.(kProfile, "streak_last_date")) ?? "";
      const nextStreak =
        m.period === "daily"
          ? streakNextUTC(String(curLast || ""), String(pKey || todayKeyUTC()), curStreak)
          : { count: curStreak, lastDate: String(curLast || "") };

      const nextTotal = await redisHIncrByCompat(redis, kProfile, "points_total", add);
      const nextClaims = await redisHIncrByCompat(redis, kProfile, "completed_total", 1);

      let didCountUnique = false;
      let nextUniqueOnce = await redisHGetInt(redis, kProfile, "unique_once_total");

      if (m.period === "once") {
        const existed = await redis.get(uniqueKey);
        if (!existed) {
          await redis.set(uniqueKey, "1");
          didCountUnique = true;
          nextUniqueOnce = await redisHIncrByCompat(redis, kProfile, "unique_once_total", 1);
        }
      }

      await redisHSetPatch(redis, kProfile, {
        streak_count: nextStreak.count,
        streak_last_date: nextStreak.lastDate,
        updatedAt: now,
      });

      let dayPoints = 0;
      let weekPoints = 0;

      if (add > 0) {
        if (m.period === "daily") dayPoints = asInt(await redis.incrBy(kPToday, add), 0);
        else if (m.period === "weekly") weekPoints = asInt(await redis.incrBy(kPWeek, add), 0);
      }

      if (add > 0) await redis.incrBy(kOldPoints, add);
      await redis.incr(kOldCompleted);

      await redis.zAdd("leaderboard:points:all", [{ score: nextTotal, value: wallet }]);
      await redis.zAdd("leaderboard:completed:all", [{ score: nextClaims, value: wallet }]);

      if (m.period === "daily") {
        const dk = `leaderboard:points:daily:${todayKeyUTC()}`;
        const sc = dayPoints || (await redisGetInt(redis, kPToday));
        await redis.zAdd(dk, [{ score: sc, value: wallet }]);
      }
      if (m.period === "weekly") {
        const wk = `leaderboard:points:weekly:${isoWeekKeyUTC()}`;
        const sc = weekPoints || (await redisGetInt(redis, kPWeek));
        await redis.zAdd(wk, [{ score: sc, value: wallet }]);
      }

      await redis.zAdd("leaderboard:points", [{ score: nextTotal, value: wallet }]);
      await redis.zAdd("leaderboard:completed", [{ score: nextClaims, value: wallet }]);

      // ✅ 上链（失败不影响 approve）
      if (add > 0) {
        try {
          // ✅ Phase B：meta（Proof of Mission）预留
          onchain = await awardPointsOnchain({
            owner: wallet,
            amount: add,
            meta: {
              missionId: m.id,
              periodKey: pKey,
              admin: auth.wallet,
              ts: now,
            },
          } as any);
        } catch (e: any) {
          onchain = { ok: false, error: e?.message ?? "onchain_error" };
        }

        // ✅ Phase A：写 last onchain receipt（用于 /api/points/summary 展示最近一次上链时间/tx）
        if (onchain?.ok && onchain?.tx) {
          try {
            await redis.set(
              `onchain:last:${wallet}`,
              JSON.stringify({
                ts: now,
                tx: onchain.tx,
                amount: add,
                missionId: m.id,
                periodKey: pKey,
                admin: auth.wallet,
              })
            );
          } catch {}
        }
      }

      const entry = {
        ts: now,
        wallet,
        missionId: m.id,
        period: m.period,
        periodKey: pKey,
        amount: add,
        reason: "admin_approved",
        admin: auth.wallet,
        note: String(body.note || "approved_by_admin"),
        proof: submission?.proof,
        submissionId: submission?.submissionId || body.submissionId,
        uniqueCounted: didCountUnique ? 1 : 0,

        onchainOk: !!onchain?.ok,
        onchainTx: onchain?.tx || null,
        onchainError: onchain?.ok ? null : (onchain?.error || null),
        onchainDidInitMissionSigner: !!onchain?.didInitMissionSigner,
        onchainDidInitPoints: !!onchain?.didInitPoints,
      };

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

      return noStoreJson({
        ok: true,
        approved: true,
        wallet,
        missionId: m.id,
        period: m.period,
        periodKey: pKey,
        pointsAdded: add,
        totalPoints: nextTotal,
        completed: nextClaims,
        uniqueCompleted: nextUniqueOnce,
        uniqueCountedThisTime: didCountUnique,
        driver,
        onchain: onchain ?? null,
      });
    }

    // -------------------- memory driver --------------------
    await memSet(claimKey, true);
    if (m.period === "once") await memSet(kOldDone, true);

    const prof = await memHGetAll(kProfile);
    const curTotal = asInt(prof.points_total ?? (await memGet(kOldPoints)), 0);
    const curClaims = asInt(prof.completed_total ?? (await memGet(kOldCompleted)), 0);
    const curUniqueOnce = asInt(prof.unique_once_total, 0);

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

    await memHSet(kProfile, {
      points_total: nextTotal,
      completed_total: nextClaims,
      unique_once_total: nextUniqueOnce,
      updatedAt: now,
    });

    if (add > 0) {
      if (m.period === "daily") await memIncrBy(kPToday, add);
      if (m.period === "weekly") await memIncrBy(kPWeek, add);
    }
    if (add > 0) await memIncrBy(kOldPoints, add);
    await memIncr(kOldCompleted);

    // ✅ memory 模式也可上链（保持一致）
    if (add > 0) {
      try {
        onchain = await awardPointsOnchain({
          owner: wallet,
          amount: add,
          meta: {
            missionId: m.id,
            periodKey: pKey,
            admin: auth.wallet,
            ts: now,
          },
        } as any);
      } catch (e: any) {
        onchain = { ok: false, error: e?.message ?? "onchain_error" };
      }
    }

    await memLPush(
      kLedger,
      {
        ts: now,
        wallet,
        missionId: m.id,
        period: m.period,
        periodKey: pKey,
        amount: add,
        reason: "admin_approved",
        admin: auth.wallet,
        note: String(body.note || "approved_by_admin"),
        submissionId: submission?.submissionId || body.submissionId,
        uniqueCounted: didCountUnique ? 1 : 0,

        onchainOk: !!onchain?.ok,
        onchainTx: onchain?.tx || null,
        onchainError: onchain?.ok ? null : (onchain?.error || null),
        onchainDidInitMissionSigner: !!onchain?.didInitMissionSigner,
        onchainDidInitPoints: !!onchain?.didInitPoints,
      },
      999
    );

    return noStoreJson({
      ok: true,
      approved: true,
      wallet,
      missionId: m.id,
      period: m.period,
      periodKey: pKey,
      pointsAdded: add,
      totalPoints: nextTotal,
      completed: nextClaims,
      uniqueCompleted: nextUniqueOnce,
      uniqueCountedThisTime: didCountUnique,
      driver,
      onchain: onchain ?? null,
    });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "approve_error" }, 500);
  }
}
