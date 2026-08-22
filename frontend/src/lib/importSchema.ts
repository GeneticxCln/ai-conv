import { z } from 'zod';

/**
 * Contract for conversation import files (`.json` picked via the header
 * upload). Mirrors what the backend `conversation:import` handler accepts;
 * validated client-side so garbage never leaves the browser.
 */
export const ImportedMessageSchema = z.object({
  role: z.enum(['user', 'agent', 'system']),
  content: z.string().max(100_000),
  agentName: z.string().max(120).optional(),
});

export const ImportPayloadSchema = z.object({
  title: z.string().max(200),
  messages: z.array(ImportedMessageSchema).min(1).max(10_000),
});

export type ImportPayload = z.infer<typeof ImportPayloadSchema>;
