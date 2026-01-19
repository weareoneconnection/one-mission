import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Driver = "memory" | "kv";
function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

// ---- memory store (dev) ----
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

// ---- kv driver (prod) ----
async function kvClient() {
  return getRedis();
}

function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeParse(s: any) {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

/** ✅ 字符串级别剥离巨大 dataUrl（最关键：在 JSON.parse 之前就砍掉） */
function stripBigDataUrls(raw: string) {
  if (typeof raw !== "string") return raw as any;
  // 把任何 "dataUrl":"data:...base64,xxxxx" 直接清空，避免 parse/stringify 巨大 payload
  return raw.replace(/"dataUrl"\s*:\s*"data:[^"]*"/g, '"dataUrl":""');
}

/** ✅ 可选瘦身 proof：删除 dataUrl/base64，避免 pending 拉取巨大数据 */
function slimProof(proof: any) {
  if (!proof || typeof proof !== "object") return proof;

  const p = proof && typeof proof === "object" ? { ...proof } : proof;

  // 常见：files[].dataUrl 很大
  if (Array.isArray((p as any).files)) {
    (p as any).files = (p as any).files.map((f: any) => {
      if (!f || typeof f !== "object") return f;
      const { dataUrl, base64, ...rest } = f; // 删掉大字段
      return rest;
    });
  }

  return p;
}

/** ✅ 把 legacy 结构字段统一成标准字段（支持 slim：跳过深拷贝） */
function normalizeSubmission(x: any, opt?: { slim?: boolean }) {
  const obj = x && typeof x === "object" ? x : { raw: x };

  const wallet =
    String(obj.wallet || obj.walletAddress || obj.address || obj.userWallet || "").trim();

  const missionId = String(obj.missionId || obj.mission || obj.mission_id || "").trim();

  const period =
    (String(obj.period || "").trim() as any) ||
    (missionId.includes(":") ? missionId.split(":")[0] : "");

  const periodKey = String(obj.periodKey || obj.period_key || obj.key || "").trim();

  const ts = Number(obj.ts || obj.createdAt || obj.time || Date.now()) || Date.now();

  // proof 强制变成纯 JSON（防止出现 function link(){[native code]} 这种）
  let proof = obj.proof;

  // ✅ slim 模式：千万不要 JSON.parse(JSON.stringify(proof))（会把 dataUrl 1.5MB 复制一遍，超级慢）
  if (opt?.slim) {
    proof = slimProof(proof);
  } else {
    try {
      proof = proof ? JSON.parse(JSON.stringify(proof)) : proof;
    } catch {}
  }

  return { ...obj, wallet, missionId, period, periodKey, ts, proof };
}

/** ✅ 生成稳定 submissionId（同一条内容永远同一个 id）
 *  修复 TS 报错：不用 crypto.subtle.digest，改用 node:crypto
 */
function stableIdFor(rawStr: string) {
  const hex12 = createHash("sha256").update(rawStr, "utf8").digest("hex").slice(0, 12);
  return `legacy-${hex12}`;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, 401);

  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(1000, num(url.searchParams.get("limit"), 200)));

    // ✅ 可选：/api/mission/pending?slim=1 返回瘦身 proof（默认不改变现有行为）
    const slim = String(url.searchParams.get("slim") || "").trim() === "1";

    const driver = pickDriver();
    const kPending = `submissions:pending`;

    if (driver === "kv") {
      const redis: any = await kvClient();

      // ✅ list 模式
      if (typeof redis.lRange === "function") {
        const raw = (await redis.lRange(kPending, 0, limit - 1)) as string[];
        const items: any[] = [];

        // 迁移标记：只要这次返回的里面有 legacy 缺 submissionId，就写回
        let migrated = 0;

        for (const s0 of raw || []) {
          // ✅ slim=1 时，在 JSON.parse 前先把巨大 dataUrl 砍掉（最关键）
          const s = slim ? stripBigDataUrls(String(s0)) : String(s0);

          const obj0 = safeParse(s);
          const obj = normalizeSubmission(obj0, { slim });

          if (!obj.submissionId) {
            const sid = stableIdFor(s); // 用当前(可能已 strip)字符串做 stableId 也稳定
            obj.submissionId = sid;

            // ✅ 写回：把这一条替换成带 submissionId 的（用 lRem + lPush 简化）
            // 注意：这会改变顺序一点点，但能接受；如果你要保序，我再给你更复杂的实现
            await redis.lRem(kPending, 1, String(s0)); // 这里用原始值删除，确保能删掉
            await redis.lPush(kPending, JSON.stringify(obj));
            migrated++;
          }

          items.push(obj);
        }

        // 你的 list 可能是 newest 在左侧，这里统一按 ts 降序
        items.sort((a, b) => (Number(b?.ts) || 0) - (Number(a?.ts) || 0));

        return noStoreJson({ ok: true, driver, items: items.slice(0, limit), migrated });
      }

      // ✅ blob 模式（老兼容）
      const blob = await redis.get(kPending);
      let arr: any[] = [];
      try {
        arr = blob ? JSON.parse(blob) : [];
      } catch {}
      const items = (Array.isArray(arr) ? arr : []).map((x) => normalizeSubmission(x, { slim }));
      items.sort((x, y) => (Number(y?.ts) || 0) - (Number(x?.ts) || 0));
      return noStoreJson({ ok: true, driver, items: items.slice(0, limit) });
    }

    // memory
    const items = ((await memGet(kPending)) ?? []) as any[];
    const list = (Array.isArray(items) ? items : []).map((x) => normalizeSubmission(x, { slim }));
    list.sort((x, y) => (Number(y?.ts) || 0) - (Number(x?.ts) || 0));
    return noStoreJson({ ok: true, driver, items: list.slice(0, limit) });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "pending_error" }, 500);
  }
}
