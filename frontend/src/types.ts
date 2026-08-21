// ============ Shared Types (mirrors backend) ============
export interface Persona {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  enabled: boolean;
  description?: string;
  avatar?: string;
}

export type MessageRole = 'user' | 'agent' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  agentName?: string;
  createdAt: string;
  isStreaming: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  participants?: string[];
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
}

export interface AgentTokenPayload {
  conversationId: string;
  messageId: string;
  agentId: string;
  agentName: string;
  token: string;
  isDone: boolean;
}

export interface AgentDonePayload {
  conversationId: string;
  messageId: string;
  agentId: string;
  agentName: string;
  fullContent: string;
}

export interface AgentErrorPayload {
  conversationId: string;
  agentId: string;
  agentName: string;
  error: string;
}
