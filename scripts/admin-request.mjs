// scripts/admin-request.mjs
import bs58 from "bs58";
import nacl from "tweetnacl";
import fs from "fs";
import crypto from "crypto";

function randNonce() {
  return bs58.encode(nacl.randomBytes(12));
}
function loadKeypair(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const secret = Uint8Array.from(raw);
  if (secret.length !== 64) throw new Error(`Bad keypair length=${secret.length} (need 64)`);
  return secret;
}
function stableJsonStringify(v) {
  const seen = new WeakSet();
  const walk = (x) => {
    if (x && typeof x === "object") {
      if (seen.has(x)) return x;
      seen.add(x);
      if (Array.isArray(x)) return x.map(walk);
      const keys = Object.keys(x).sort();
      const o = {};
      for (const k of keys) o[k] = walk(x[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(walk(v));
}
function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/admin-request.mjs "<url>" [method] [jsonBody] [keypairPath] [timeoutMs]');
  process.exit(1);
}

const method = (process.argv[3] || "GET").toUpperCase();
const bodyRaw = process.argv[4] || "";
const keypairPath = process.argv[5] || `${process.env.HOME}/.config/solana/id.json`;
const timeoutMs = Number(process.argv[6] || "10000"); // 默认 10s

const secretKey = loadKeypair(keypairPath);
const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
const wallet58 = bs58.encode(kp.publicKey);

const ts = Date.now().toString();
const nonce = randNonce();

let bodyObj = {};
if (method !== "GET") {
  try {
    bodyObj = bodyRaw ? JSON.parse(bodyRaw) : {};
  } catch (e) {
    console.error("Bad JSON body:", e?.message || e);
    process.exit(1);
  }
}

const apiPath = (() => {
  try {
    return new URL(url).pathname;
  } catch {
    // fallback: crude
    const i = url.indexOf("://");
    const rest = i > -1 ? url.slice(i + 3) : url;
    const j = rest.indexOf("/");
    return j > -1 ? rest.slice(j) : "/";
  }
})();

const bodyStr = method === "GET" ? "" : stableJsonStringify(bodyObj);
const bodyHash = method === "GET" ? "" : sha256Hex(bodyStr);

// ✅ msg 格式对齐你现在的 adminSig.ts（重要）
const msgParts = [];
msgParts.push(`${method}:${apiPath}`);
msgParts.push(`cluster=mainnet-beta`);
if (method !== "GET") msgParts.push(`body=${bodyHash}`);

// 你后端 approve 会用 submissionId / wallet / missionId / amount 等字段做绑定的话，这里也可以追加
if (bodyObj?.submissionId) msgParts.push(`submissionId=${String(bodyObj.submissionId)}`);
if (bodyObj?.wallet) msgParts.push(`wallet=${String(bodyObj.wallet)}`);
if (bodyObj?.missionId) msgParts.push(`missionId=${String(bodyObj.missionId)}`);
if (bodyObj?.points != null) msgParts.push(`points=${String(bodyObj.points)}`);
if (bodyObj?.amount != null) msgParts.push(`amount=${String(bodyObj.amount)}`);

const xAdminMsg = msgParts.join("|");
const payload = `${xAdminMsg}|${ts}`;
const sig = nacl.sign.detached(Buffer.from(payload, "utf8"), secretKey);
const sig58 = bs58.encode(sig);

const headers = {
  "x-admin-wallet": wallet58,
  "x-admin-timestamp": ts,
  "x-admin-msg": xAdminMsg,
  "x-admin-signature": sig58,
};

const controller = new AbortController();
const t = setTimeout(() => controller.abort(), timeoutMs);

try {
  const init = {
    method,
    headers: {
      ...headers,
      ...(method !== "GET" ? { "content-type": "application/json" } : {}),
    },
    body: method !== "GET" ? bodyStr : undefined,
    signal: controller.signal,
  };

  // DEBUG：把请求头打出来（方便你对比）
  console.error("[admin-request] url =", url);
  console.error("[admin-request] headers =", headers);
  if (method !== "GET") console.error("[admin-request] body =", bodyStr);

  const res = await fetch(url, init);
  const text = await res.text();

  console.error("[admin-request] status =", res.status);
  process.stdout.write(text);
} catch (e) {
  if (String(e?.name) === "AbortError") {
    console.error(`\n[admin-request] TIMEOUT after ${timeoutMs}ms`);
  } else {
    console.error("\n[admin-request] ERROR:", e?.message || e);
  }
  process.exit(1);
} finally {
  clearTimeout(t);
}
