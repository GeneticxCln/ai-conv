import { getRedisClient } from './client.js';

// ── Rate-limit windows (ms) ────────────────────────────────────────
const PULL_RATE_LIMIT_WINDOW = 60_000;
const MESSAGE_RATE_WINDOW = 10_000;
const CREATE_RATE_WINDOW = 30_000;
const REGENERATE_RATE_WINDOW = 5_000;

// ── Max requests per window ────────────────────────────────────────
const PULL_RATE_LIMIT_MAX = 3;
const MESSAGE_RATE_MAX = 5;
const CREATE_RATE_MAX = 10;
const REGENERATE_RATE_MAX = 1;

type RateLimitType = 'pull' | 'message' | 'create' | 'regenerate';

const CONFIG: Record<RateLimitType, { window: number; max: number }> = {
  pull:       { window: PULL_RATE_LIMIT_WINDOW,    max: PULL_RATE_LIMIT_MAX },
  message:    { window: MESSAGE_RATE_WINDOW,        max: MESSAGE_RATE_MAX },
  create:     { window: CREATE_RATE_WINDOW,         max: CREATE_RATE_MAX },
  regenerate: { window: REGENERATE_RATE_WINDOW,     max: REGENERATE_RATE_MAX },
};

/**
 * Generic Redis-backed rate limiter using sorted sets (ZSET).
 * Key pattern: `ratelimit:{type}:{id}`
 * Returns `true` when the request is allowed, `false` when rate-limited.
 * Gracefully degrades to always-allow when Redis is unavailable.
 */
async function checkRateLimit(
  type: RateLimitType,
  id: string,
): Promise<boolean> {
  const cfg = CONFIG[type];
  try {
    const redis = getRedisClient();
    if (!redis) return true; // No Redis — allow all (local dev)
    const key = `ratelimit:${type}:${id}`;
    const now = Date.now();
    const windowStart = now - cfg.window;

    await redis.zremrangebyscore(key, 0, windowStart);
    const count = await redis.zcard(key);

    if (count >= cfg.max) return false;

    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    await redis.zadd(key, now, member);
    await redis.expire(key, Math.ceil(cfg.window / 1000) + 10);

    return true;
  } catch {
    // Redis unavailable — allow (degrade gracefully)
    return true;
  }
}

// ── Public API ─────────────────────────────────────────────────────

/** Rate-limit model pulls (3/min per socket). */
export async function checkPullRateLimit(socketId: string, _modelName: string): Promise<boolean> {
  return checkRateLimit('pull', socketId);
}

/** Rate-limit message sends (5/10s per conversation). */
export async function checkMessageRateLimit(conversationId: string): Promise<boolean> {
  return checkRateLimit('message', conversationId);
}

/** Rate-limit entity creation (10/30s per socket). Used for persona:create, conversation:create, user:create. */
export async function checkCreateRateLimit(socketId: string): Promise<boolean> {
  return checkRateLimit('create', socketId);
}

/** Rate-limit regeneration (1/5s per conversation). */
export async function checkRegenerateRateLimit(conversationId: string): Promise<boolean> {
  return checkRateLimit('regenerate', conversationId);
}

/** Clean up all rate-limit keys for a socket on disconnect. */
export async function cleanupRateLimit(socketId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return; // No Redis — nothing to clean
    // Use SCAN instead of KEYS to avoid blocking Redis
    const pattern = `ratelimit:*:${socketId}`;
    const keys: string[] = [];
    for await (const chunk of redis.scanStream({ match: pattern, count: 100 })) {
      if (Array.isArray(chunk)) {
        for (const item of chunk) {
          if (typeof item === 'string') keys.push(item);
        }
      } else if (typeof chunk === 'string') {
        keys.push(chunk);
      }
    }
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // ignore
  }
}