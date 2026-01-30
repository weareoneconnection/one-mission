// scripts/adminSign.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

type Cmd = "approve" | "addPoints";

type ApproveArgs = { submissionId: string };
type AddPointsArgs = { wallet: string; amount: number };

type Flags = Record<string, string | boolean>;

function loadKeypair(): Uint8Array {
  const kpPath =
    process.env.SOLANA_KEYPAIR ||
    path.join(process.env.HOME || "", ".config", "solana", "id.json");

  const secret = JSON.parse(fs.readFileSync(kpPath, "utf8"));
  const secretKey = Uint8Array.from(secret); // 64 bytes
  if (secretKey.length !== 64) {
    throw new Error(`Bad keypair length=${secretKey.length} (need 64)`);
  }
  return secretKey;
}

/** 支持：--k v 以及 --k=v */
function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) continue;

    const eq = a.indexOf("=");
    if (eq > -1) {
      const k = a.slice(2, eq).trim();
      const v = a.slice(eq + 1).trim();
      out[k] = v;
      continue;
    }

    const k = a.slice(2).trim();
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[k] = next;
      i++;
    } else {
      out[k] = true;
    }
  }
  return out;
}

function stableJsonStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  const sorter = (x: any): any => {
    if (x && typeof x === "object") {
      if (seen.has(x)) return x;
      seen.add(x);

      if (Array.isArray(x)) return x.map(sorter);
      const keys = Object.keys(x).sort();
      const o: Record<string, any> = {};
      for (const k of keys) o[k] = sorter(x[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(sorter(v));
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * ✅ 建议：把接口路径写进 msg，避免签名被拿去调用别的接口
 * 并绑定 cluster + body hash + extra
 */
function buildAdminMsg(input: {
  method: "POST" | "GET";
  apiPath: string;
  body?: unknown;
  cluster?: string;
  extra?: Record<string, string | number | boolean | undefined>;
}): string {
  const cluster = String(input.cluster || "mainnet-beta");
  const bodyStr =
    input.method === "GET" ? "" : stableJsonStringify(input.body ?? {});
  const bodyHash = input.method === "GET" ? "" : sha256Hex(bodyStr);

  const parts: string[] = [];
  parts.push(`${input.method}:${input.apiPath}`);
  parts.push(`cluster=${cluster}`);
  if (input.method !== "GET") parts.push(`body=${bodyHash}`);

  if (input.extra) {
    const keys = Object.keys(input.extra).sort();
    for (const k of keys) {
      const v = input.extra[k];
      if (v === undefined) continue;
      parts.push(`${k}=${String(v)}`);
    }
  }

  return parts.join("|");
}

function signHeaders(secretKey64: Uint8Array, msg: string, timestamp: string) {
  const payload = `${msg}|${timestamp}`;
  const sig = nacl.sign.detached(Buffer.from(payload, "utf8"), secretKey64);

  const kp = nacl.sign.keyPair.fromSecretKey(secretKey64);
  const wallet = bs58.encode(kp.publicKey);

  return {
    "x-admin-wallet": wallet,
    "x-admin-timestamp": timestamp,
    "x-admin-msg": msg,
    "x-admin-signature": bs58.encode(sig),
  };
}

function usageAndExit() {
  console.log(`Usage:
  npx tsx scripts/adminSign.ts approve --submissionId abc123
  npx tsx scripts/adminSign.ts approve --submissionId=abc123

  npx tsx scripts/adminSign.ts addPoints --wallet <WALLET> --amount 50
  npx tsx scripts/adminSign.ts addPoints --wallet=<WALLET> --amount=50
`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = (argv[0] || "") as Cmd;

  if (!cmd || (cmd !== "approve" && cmd !== "addPoints")) {
    usageAndExit();
  }

  const flags = parseFlags(argv.slice(1));
  const secretKey = loadKeypair();
  const timestamp = Date.now().toString();

  if (cmd === "approve") {
    const submissionId = String(flags.submissionId || "").trim();
    if (!submissionId) usageAndExit();

    const msg = buildAdminMsg({
      method: "POST",
      apiPath: "/api/mission/approve",
      body: { submissionId },
      cluster: "mainnet-beta",
      extra: { submissionId },
    });

    const h = signHeaders(secretKey, msg, timestamp);

    console.log("\n--- COPY BELOW ---\n");
    console.log(`x-admin-wallet: ${h["x-admin-wallet"]}`);
    console.log(`x-admin-timestamp: ${h["x-admin-timestamp"]}`);
    console.log(`x-admin-msg: ${h["x-admin-msg"]}`);
    console.log(`x-admin-signature: ${h["x-admin-signature"]}`);
    console.log("\n------------------\n");
    return;
  }

  // addPoints
  const wallet = String(flags.wallet || flags.target || "").trim();
  const amount = Number(flags.amount || 0);
  if (!wallet || !Number.isFinite(amount) || amount <= 0) usageAndExit();

  const msg = buildAdminMsg({
    method: "POST",
    apiPath: "/api/points/admin/add",
    body: { wallet, amount },
    cluster: "mainnet-beta",
    extra: { target: wallet, amount },
  });

  const h = signHeaders(secretKey, msg, timestamp);

  console.log("\n--- COPY BELOW ---\n");
  console.log(`x-admin-wallet: ${h["x-admin-wallet"]}`);
  console.log(`x-admin-timestamp: ${h["x-admin-timestamp"]}`);
  console.log(`x-admin-msg: ${h["x-admin-msg"]}`);
  console.log(`x-admin-signature: ${h["x-admin-signature"]}`);
  console.log("\n------------------\n");
}

main().catch((e) => {
  console.error("[adminSign] error:", e?.message || e);
  process.exit(1);
});

