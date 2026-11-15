import { z } from 'zod';

// ============ Base Types ============
export const AgentIdSchema = z.string().uuid();
export type AgentId = z.infer<typeof AgentIdSchema>;

// ============ Persona ============
export const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  avatar: z.string().optional(),
  enabledTools: z.boolean().default(false),
  userId: z.string().uuid().optional(),
});
export type Persona = z.infer<typeof PersonaSchema>;

// ============ Message ============
export const MessageRoleSchema = z.enum(['user', 'agent', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  agentId: AgentIdSchema.optional(),
  agentName: z.string().optional(),
  createdAt: z.string().datetime(),
  isStreaming: z.boolean().default(false),
});
export type Message = z.infer<typeof MessageSchema>;

// ============ Conversation ============
export const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().default('New Conversation'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  userId: z.string().uuid().optional(),
  participants: z.array(z.string().uuid()).optional(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

// ============ Socket Events ============
export const UserMessagePayloadSchema = z.object({
  conversationId: z.string().uuid(),
  // The first message becomes the conversation title, so blank text would
  // permanently blank the title. Reject empty and whitespace-only messages.
  content: z.string().min(1).max(100000).refine((value) => value.trim().length > 0, {
    message: 'Message cannot be empty',
  }),
  agentChat: z.boolean().optional(),
  tempId: z.string().uuid().optional(),
});
export type UserMessagePayload = z.infer<typeof UserMessagePayloadSchema>;

export const AgentTokenPayloadSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  agentId: AgentIdSchema,
  agentName: z.string(),
  token: z.string(),
  isDone: z.boolean().default(false),
});
export type AgentTokenPayload = z.infer<typeof AgentTokenPayloadSchema>;

export const AgentDonePayloadSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  agentId: AgentIdSchema,
  agentName: z.string(),
  fullContent: z.string(),
});
export type AgentDonePayload = z.infer<typeof AgentDonePayloadSchema>;

export const AgentErrorPayloadSchema = z.object({
  conversationId: z.string().uuid(),
  agentId: AgentIdSchema,
  agentName: z.string(),
  error: z.string(),
});
export type AgentErrorPayload = z.infer<typeof AgentErrorPayloadSchema>;

export const ConversationImportSchema = z.object({
  title: z.string().max(200).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'agent', 'system']),
    content: z.string().max(100000),
    agentName: z.string().max(120).optional(),
    createdAt: z.string().datetime().optional(),
  })).max(10000),
});
export type ConversationImport = z.infer<typeof ConversationImportSchema>;

export const SocketEvents = {
  USER_MESSAGE: 'user:message',
  AGENT_TOKEN: 'agent:token',
  AGENT_DONE: 'agent:done',
  AGENT_ERROR: 'agent:error',
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_CREATE: 'conversation:create',
  AGENTS_LIST: 'agents:list',
  AGENT_TOGGLE: 'agent:toggle',
}
// export { z };  // Removed duplicate - already exported at line 104

// ============ Tool Types ============
export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (params: Record<string, unknown>) => Promise<string>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: string;
  error?: string;
}

// ============ API Types ============
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
  ollama: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export { z };