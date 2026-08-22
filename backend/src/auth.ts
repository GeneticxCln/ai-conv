import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { db } from './storage/db';

const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
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
  
  const user = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(payload.userId) as any;
  return user || null;
}

export function createUserWithToken(name: string, avatar?: string) {
  const { createUser, getUser } = require('./storage/db');
  const user = createUser(name, avatar);
  const token = generateToken(user);
  return { user, token };
}

export function authenticateSocket(socket: any, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    return next(new Error('Invalid token'));
  }
  
  const user = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(payload.userId) as any;
  if (!user) {
    return next(new Error('User not found'));
  }
  
  (socket as any).user = user;
  next();
}

export { JWT_SECRET };