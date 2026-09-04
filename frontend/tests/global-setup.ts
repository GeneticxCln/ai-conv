import { io } from 'socket.io-client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { pickFastestChatModel, InstalledModel } from '../src/lib/modelPicker';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0]?.use?.baseURL || 'http://127.0.0.1:5173');
  const backendURL = process.env.PLAYWRIGHT_BACKEND_URL || 'http://127.0.0.1:3001';
  const socket = io(backendURL, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 10_000,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    const result = await socket.emitWithAck('user:create', { name: 'Playwright User', avatar: '🧪' }) as {
      ok?: boolean;
      token?: string;
      error?: string;
    };
    if (!result?.token) {
      throw new Error(`Could not create E2E profile: ${result?.error || 'missing token'}`);
    }

    // Pick the fastest installed chat model once, here, and store it for the
    // spec. Picking inside the persona modal used to take the FIRST option in
    // the dropdown — which is Ollama's installation order and can be a huge
    // model (e.g. a 27B), making streaming tests crawl or time out in CI.
    // Fewer parameters = faster, so rank by parameter size, then file size.
    const modelPath = path.resolve(process.cwd(), 'tests/.auth/model.json');
    try {
      const models = await socket.emitWithAck('models:list:full') as InstalledModel[] | undefined;
      const pick = pickFastestChatModel(Array.isArray(models) ? models : []);
      if (pick) {
        await mkdir(path.dirname(modelPath), { recursive: true });
        await writeFile(modelPath, JSON.stringify({ name: pick.name }), 'utf8');
        console.log(`[global-setup] Fastest chat model: ${pick.name} (${pick.parameterSize || 'size unknown'})`);
      } else {
        console.warn('[global-setup] No chat-capable model found via models:list:full');
      }
    } catch (error) {
      console.warn(
        '[global-setup] Could not list models, falling back to dropdown order:',
        error instanceof Error ? error.message : String(error),
      );
    }

    const storagePath = path.resolve(process.cwd(), 'tests/.auth/user.json');
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, JSON.stringify({
      cookies: [],
      origins: [{
        origin: baseURL,
        localStorage: [{ name: 'aiconv_token', value: result.token }],
      }],
    }), 'utf8');
  } finally {
    socket.close();
  }
}
