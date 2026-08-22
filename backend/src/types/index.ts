import { z } from 'zod';

// ============ Base Types ============
export const AgentIdSchema = z.string().uuid();
export type AgentId = z.infer<typeof AgentIdSchema>;

// ============ Persona ============
export const PersonaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().default('llama3.1:8b'),
  systemPrompt: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  avatar: z.string().optional(),
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
});
export type Conversation = z.infer<typeof ConversationSchema>;

// ============ Socket Events ============
export const UserMessagePayloadSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1),
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

// ============ Socket Event Names ============
export const SocketEvents = {
  USER_MESSAGE: 'user:message',
  AGENT_TOKEN: 'agent:token',
  AGENT_DONE: 'agent:done',
  AGENT_ERROR: 'agent:error',
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_CREATE: 'conversation:create',
  AGENTS_LIST: 'agents:list',
  AGENT_TOGGLE: 'agent:toggle',
} as const;

// ============ API Types ============
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
  ollama: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
