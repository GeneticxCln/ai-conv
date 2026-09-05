import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { claimUnownedData, createUser, getUser, getUsers } from './storage/db.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Try reading from .env in project root
  try {
    const envPath = resolve(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^JWT_SECRET=(.+)$/m);
      if (match) return match[1].trim();
    }
  } catch { /* ignore */ }

  // Persistent random secret stored next to the database or shared data dir.
  // Check all candidate locations across dev, docker, and electron environments.
  const candidateDirs = [
    process.env.DATABASE_PATH ? dirname(resolve(process.env.DATABASE_PATH)) : null,
    resolve(process.cwd(), 'data'),
    resolve(process.cwd(), 'backend', 'data'),
    resolve(process.cwd(), '..', 'backend', 'data'),
    resolve(process.cwd(), '..', 'data'),
  ].filter((d): d is string => Boolean(d));

  for (const dir of candidateDirs) {
    const candidatePath = resolve(dir, '.jwt-secret');
    if (existsSync(candidatePath)) {
      try { return readFileSync(candidatePath, 'utf-8').trim(); } catch { /* ignore unreadable candidate */ }
    }
  }

  const primaryDir = candidateDirs[0] || resolve(process.cwd(), 'data');
  const secretPath = resolve(primaryDir, '.jwt-secret');
  try {
    const secret = randomBytes(32).toString('hex');
    mkdirSync(primaryDir, { recursive: true });
    writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
  } catch {
    // Last resort: ephemeral secret (tokens invalid on restart, but safe)
    return randomBytes(32).toString('hex');
  }
}

const JWT_SECRET = loadJwtSecret();
const JWT_EXPIRES_IN = '7d';

export interface AuthPayload {
  userId: string;
  username: string;
}

export function generateToken(user: { id: string; name: string }): string {
  return jwt.sign(
    { userId: user.id, username: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function getUserFromToken(token: string) {
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUser(payload.userId);
}

export function createToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function createUserWithToken(name: string, avatar?: string) {
  const firstUser = getUsers().length === 0;
  const row = createUser(name, avatar);
  if (firstUser) claimUnownedData(row.id);
  const user = { id: row.id, name: row.name, avatar: row.avatar };
  return { user: row, token: generateToken(user) };
}

export { JWT_SECRET };
