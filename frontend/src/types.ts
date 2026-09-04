// ============ Re-export shared types from @ai-conv/types ============
export type {
  Persona,
  MessageRole,
  Message,
  Conversation,
  UserMessagePayload,
  AgentTokenPayload,
  AgentDonePayload,
  AgentErrorPayload,
  ConversationImport,
  Tool,
  ToolCall,
  ToolResult,
  HealthResponse,
} from '@ai-conv/types';

// Frontend-only extensions
export interface User {
  id: string;
  name: string;
  avatar?: string;
}
