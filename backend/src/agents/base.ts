import { Persona, Message, AgentTokenPayload, AgentDonePayload, AgentErrorPayload } from '../types';
import { streamChat, StreamChunk } from '../llm/ollama';
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

  // Stream response to socket
  async *streamResponse(
    conversationId: string,
    history: Message[],
    userMessage: string,
    signal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    const mapped = history.map(m => ({
      role: m.role === 'agent' ? 'assistant' as const : m.role,
      content: m.content,
    }));
    const messages = userMessage
      ? [...mapped, { role: 'user' as const, content: userMessage }]
      : mapped;

    for await (const chunk of streamChat(this.persona, messages, signal)) {
      this.emitToken(conversationId, chunk.token, chunk.done);
      yield chunk;
    }
  }

  protected emitToken(conversationId: string, token: string, isDone: boolean) {
    const payload: AgentTokenPayload = {
      conversationId,
      messageId: '', // Will be filled by caller
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
