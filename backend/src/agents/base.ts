import { Persona, Message, AgentTokenPayload, AgentDonePayload, AgentErrorPayload } from '@ai-conv/types';
import { streamChat, StreamChunk } from '../llm/ollama';
import { truncateHistory } from '../utils.js';
import { Server } from 'socket.io';

// ============ Base Agent ============
export abstract class BaseAgent {
  protected persona: Persona;
  protected io: Server;

  constructor(persona: Persona, io: Server) {
    this.persona = persona;
    this.io = io;
  }

  get id(): string {
    return this.persona.id;
  }

  get name(): string {
    return this.persona.name;
  }

  get enabled(): boolean {
    return this.persona.enabled;
  }

  // Abstract method to handle user message
  abstract handleUserMessage(
    conversationId: string,
    userMessage: string,
    history: Message[]
  ): Promise<void>;

  // Continue without a new user message (agent-to-agent round)
  abstract handleContinue(conversationId: string, history: Message[]): Promise<void>;

  // Stream response to socket. Callers pass the messageId of the DB message
  // being streamed so that every token carries a valid messageId to the
  // frontend (fixes multi-agent streaming where all agents previously
  // shared messageId='').
  async *streamResponse(
    conversationId: string,
    history: Message[],
    userMessage: string,
    signal?: AbortSignal,
    messageId?: string
  ): AsyncGenerator<StreamChunk> {
    // Truncate to most recent 40 messages to prevent context overflow
    const truncated = truncateHistory(history);
    // Safety cap: never send more than 40 history messages even if
    // truncateHistory misbehaves.
    const capped = truncated.slice(-40);
    const mapped = capped.map(m => ({
      role: m.role === 'agent' ? 'assistant' as const : m.role,
      content: m.content,
    }));
    const messages = userMessage
      ? [{ role: 'system' as const, content: this.persona.systemPrompt }, ...mapped, { role: 'user' as const, content: userMessage }]
      : [{ role: 'system' as const, content: this.persona.systemPrompt }, ...mapped, { role: 'user' as const, content: 'Please continue the discussion.' }];

    for await (const chunk of streamChat(this.persona, messages, signal)) {
      if (chunk.error) {
        throw new Error(chunk.error);
      }
      this.emitToken(conversationId, chunk.token, chunk.done, messageId);
      yield chunk;
    }
  }

  protected emitToken(conversationId: string, token: string, isDone: boolean, messageId?: string) {
    const payload: AgentTokenPayload = {
      conversationId,
      messageId: messageId ?? '',
      agentId: this.id,
      agentName: this.name,
      token,
      isDone,
    };
    this.io.to(conversationId).emit('agent:token', payload);
  }

  protected emitDone(conversationId: string, messageId: string, fullContent: string) {
    const payload: AgentDonePayload = {
      conversationId,
      messageId,
      agentId: this.id,
      agentName: this.name,
      fullContent,
    };
    this.io.to(conversationId).emit('agent:done', payload);
  }

  protected emitError(conversationId: string, error: string) {
    const payload: AgentErrorPayload = {
      conversationId,
      agentId: this.id,
      agentName: this.name,
      error,
    };
    this.io.to(conversationId).emit('agent:error', payload);
  }
}
