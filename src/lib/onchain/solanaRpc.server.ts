type JsonRpcResponse<T> = { result?: T; error?: { message: string } };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(base: number) {
  return base + Math.floor(Math.random() * 150);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function rpcCallOnce<T>(rpcUrl: string, method: string, params: any[]): Promise<T> {
  const res = await fetchWithTimeout(
    rpcUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    8000
  );

  if (res.status === 429 || res.status === 503) {
    throw new Error(`RPC rate limited (${res.status})`);
  }
  if (res.status >= 500) {
    throw new Error(`RPC server error (${res.status})`);
  }

  let json: JsonRpcResponse<T>;
  try {
    json = (await res.json()) as JsonRpcResponse<T>;
  } catch {
    throw new Error("RPC returned non-JSON response");
  }

  if (json.error) throw new Error(json.error.message);
  if (json.result === undefined) throw new Error("RPC: empty result");

  return json.result;
}

async function rpcCall<T>(rpcUrl: string, method: string, params: any[]): Promise<T> {
  const max = 5;
  let lastErr: any;

  // 递增退避：250, 600, 1100, 1800, 2600 (+ jitter)
  const waits = [250, 600, 1100, 1800, 2600];

  for (let i = 0; i < max; i++) {
    try {
      return await rpcCallOnce<T>(rpcUrl, method, params);
    } catch (e: any) {
      lastErr = e;
      await sleep(jitter(waits[i] ?? 2600));
    }
  }
  throw lastErr;
}

export async function getSolLamports(rpcUrl: string, owner: string): Promise<number> {
  const result = await rpcCall<{ value: number }>(rpcUrl, "getBalance", [
    owner,
    { commitment: "confirmed" },
  ]);
  return result.value;
}

export async function getSplTokenAmount(
  rpcUrl: string,
  owner: string,
  mint: string
): Promise<number> {
  const result = await rpcCall<{
    value: Array<{
      account: {
        data: {
          parsed: {
            info: {
              tokenAmount: { uiAmount: number | null; amount: string; decimals: number };
            };
          };
        };
      };
    }>;
  }>(rpcUrl, "getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  let sum = 0;
  for (const it of result.value) {
    const ta = it.account.data.parsed.info.tokenAmount;
    sum += ta.uiAmount ?? 0;
  }
  return sum;
}

// —— NFT (Helius DAS) —— //
type HeliusAsset = {
  id: string;
  grouping?: Array<{ group_key: string; group_value: string }>;
};

export async function ownsNftCollectionViaHeliusDAS(
  heliusRpcUrl: string,
  owner: string,
  collection: string
): Promise<boolean> {
  let page = 1;
  const limit = 100;

  while (page <= 10) {
    const result = await rpcCall<{
      items: HeliusAsset[];
      limit: number;
      page: number;
    }>(heliusRpcUrl, "getAssetsByOwner", [
      { ownerAddress: owner, page, limit },
    ]);

    for (const a of result.items ?? []) {
      const grouping = a.grouping ?? [];
      const hit = grouping.some(
        (g) =>
          g.group_key === "collection" &&
          String(g.group_value).toLowerCase() === collection.toLowerCase()
      );
      if (hit) return true;
    }

    if (!result.items || result.items.length < limit) break;
    page += 1;
  }

  return false;
}
