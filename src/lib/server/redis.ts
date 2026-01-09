import { createClient, RedisClientType } from "redis";

declare global {
  // eslint-disable-next-line no-var
  var __REDIS__: RedisClientType | undefined;
}

export async function getRedis() {
  if (!global.__REDIS__) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");

    global.__REDIS__ = createClient({ url });
    await global.__REDIS__.connect();
  }

  return global.__REDIS__;
}
