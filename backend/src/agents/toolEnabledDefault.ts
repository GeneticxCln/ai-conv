import { Persona, Message } from '@ai-conv/types';
import { ToolEnabledAgent } from './toolEnabledAgent.js';
import { Server } from 'socket.io';
import { createMessage, updateMessageContent } from '../storage/db.js';
import { registerStream, releaseStream, streamChat } from '../llm/ollama.js';

export interface ToolCallJson {
  name: string;
  arguments?: Record<string, unknown>;
}

export function parseToolCalls(content: string): ToolCallJson[] | null {
  const trimmed = content.trim();
  let jsonStr = trimmed;
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  const objMatch = jsonStr.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (objMatch) {
    jsonStr = objMatch[0];
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return (parsed.tool_calls as unknown[]).filter(
        (call): call is ToolCallJson =>
          typeof call === 'object' && call !== null && 'name' in call && typeof (call as Record<string, unknown>).name === 'string'
      );
    }
  } catch {
    // Not valid tool_calls JSON
  }
  return null;
}

// ============ Tool-Enabled Default Agent ============
export class ToolEnabledDefaultAgent extends ToolEnabledAgent {
  constructor(persona: Persona, io: Server) {
    super(persona, io);
  }

  async handleUserMessage(conversationId: string, userMessage: string, history: Message[]) {
    const agentMessage = createMessage(
      conversationId,
      'agent',
      '',
      this.id,
      this.name,
      true
    );

    const key = `${conversationId}:${this.id}`;
    const controller = registerStream(key);
    let fullContent = '';

    try {
      // First pass: stream response to see if model emits normal text or tool_calls
      for await (const chunk of this.streamResponse(conversationId, history, userMessage, controller.signal, agentMessage.id)) {
        fullContent += chunk.token;
        updateMessageContent(agentMessage.id, fullContent, !chunk.done);
      }

      // Check if output requested tool execution
      const toolCalls = parseToolCalls(fullContent);
      if (toolCalls && toolCalls.length > 0 && !controller.signal.aborted) {
        // Inform user tool execution is in progress
        const toolNames = toolCalls.map(t => t.name).join(', ');
        updateMessageContent(agentMessage.id, `[Executing: ${toolNames}...]`, true);
        this.emitToken(conversationId, `\n\n*[Tool: ${toolNames}]*\n\n`, false, agentMessage.id);

        // Execute all requested tools
        const toolResults: string[] = [];
        for (const call of toolCalls) {
          const res = await this.toolRegistry.execute({
            name: call.name,
            arguments: call.arguments || {},
          });
          toolResults.push(`Result for "${call.name}":\n${res.result || res.error || '(no output)'}`);
        }

        // Build follow-up messages incorporating the tool results
        const toolMessage = `Tool execution output:\n${toolResults.join('\n\n')}\n\nPlease provide your final response to the user based on these tool results.`;
        const followUpHistory = [
          ...history,
          {
            id: agentMessage.id,
            conversationId,
            role: 'agent' as const,
            content: fullContent,
            agentId: this.id,
            agentName: this.name,
            createdAt: new Date().toISOString(),
            isStreaming: false,
          },
        ];

        // Reset message content for final answer streaming
        fullContent = '';
        updateMessageContent(agentMessage.id, '', true);

        for await (const chunk of this.streamResponse(conversationId, followUpHistory, toolMessage, controller.signal, agentMessage.id)) {
          fullContent += chunk.token;
          updateMessageContent(agentMessage.id, fullContent, !chunk.done);
        }
      }

      updateMessageContent(agentMessage.id, fullContent, false);
      this.emitDone(conversationId, agentMessage.id, fullContent);
    } catch (error: unknown) {
      const errObj = error as { name?: string; message?: string } | undefined;
      if (errObj?.name === 'AbortError' || controller.signal.aborted) {
        updateMessageContent(agentMessage.id, fullContent + ' …', false);
        this.emitDone(conversationId, agentMessage.id, fullContent + ' …');
      } else {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        this.emitError(conversationId, errMsg);
        updateMessageContent(agentMessage.id, `[Error: ${errMsg}]`, false);
      }
    } finally {
      releaseStream(key);
    }
  }

  async handleContinue(conversationId: string, history: Message[]) {
    const agentMessage = createMessage(conversationId, 'agent', '', this.id, this.name, true);
    const key = `${conversationId}:${this.id}`;
    const controller = registerStream(key);
    let fullContent = '';

    try {
      for await (const chunk of this.streamResponse(conversationId, history, '', controller.signal, agentMessage.id)) {
        fullContent += chunk.token;
        updateMessageContent(agentMessage.id, fullContent, !chunk.done);
      }
      updateMessageContent(agentMessage.id, fullContent, false);
      this.emitDone(conversationId, agentMessage.id, fullContent);
    } catch (error: unknown) {
      const errObj = error as { name?: string; message?: string } | undefined;
      const aborted = errObj?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        updateMessageContent(agentMessage.id, fullContent + ' …', false);
        this.emitDone(conversationId, agentMessage.id, fullContent + ' …');
      } else {
        updateMessageContent(agentMessage.id, fullContent, false);
        if (fullContent) this.emitDone(conversationId, agentMessage.id, fullContent);
      }
    } finally {
      releaseStream(key);
    }
  }

  async *streamResponse(
    conversationId: string,
    history: Message[],
    userMessage: string,
    signal?: AbortSignal,
    messageId?: string
  ): AsyncGenerator<{ token: string; done: boolean; error?: string }> {
    const messages = this.buildMessages(history, userMessage);
    for await (const chunk of streamChat(this.persona, messages, signal)) {
      if (chunk.error) throw new Error(chunk.error);
      this.emitToken(conversationId, chunk.token, chunk.done, messageId);
      yield chunk;
    }
  }
}
