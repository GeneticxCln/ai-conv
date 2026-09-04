import Redis from 'ioredis';

let redisClient: Redis | null = null;

/** True when REDIS_URL was explicitly set by the user. */
function hasRedisUrl(): boolean {
  const url = process.env.REDIS_URL;
  return !!url && url.length > 0;
}

export function getRedisClient(): Redis | null {
  if (!hasRedisUrl()) return null;
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL!;

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) return null; // Stop retrying
      return Math.min(times * 200, 2000);
    },
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  redisClient.on('connect', () => {
    console.log('[Redis] Connected');
  });

  redisClient.on('ready', () => {
    console.log('[Redis] Ready');
  });

  return redisClient;
}

export async function connectRedis(): Promise<Redis | null> {
  const client = getRedisClient();
  if (!client) return null; // No REDIS_URL configured — skip silently
  if (client.status === 'wait') {
    await client.connect();
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      // Connection already closed — ignore
    }
    redisClient = null;
  }
}