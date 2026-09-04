import { BaseAgent } from './base';
import { Message } from '@ai-conv/types';
import { createMessage, updateMessageContent } from '../storage/db';
import { registerStream, releaseStream } from '../llm/ollama';

// ============ Default Agent Implementation ============
export class DefaultAgent extends BaseAgent {
  async handleUserMessage(conversationId: string, userMessage: string, history: Message[]) {
    console.log('[DefaultAgent] Handling message:', conversationId, userMessage.slice(0, 50));
    // Create agent message entry (streaming)
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
    let aborted = false;
    try {
      console.log('[DefaultAgent] Starting stream for model:', this.persona.model);
      let tokenCount = 0;
      for await (const chunk of this.streamResponse(conversationId, history, userMessage, controller.signal, agentMessage.id)) {
        fullContent += chunk.token;
        tokenCount++;
        updateMessageContent(agentMessage.id, fullContent, !chunk.done);
      }
      console.log('[DefaultAgent] Stream done, tokens:', tokenCount, 'content length:', fullContent.length);
      updateMessageContent(agentMessage.id, fullContent, false);
      this.emitDone(conversationId, agentMessage.id, fullContent);
      console.log('[DefaultAgent] emitDone called');
    } catch (error: any) {
      aborted = error?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        // Keep partial content, finish gracefully
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

  // Continue conversation without a new user message (agent-to-agent round)
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
    } catch (error: any) {
      const aborted = error?.name === 'AbortError' || controller.signal.aborted;
      if (aborted) {
        updateMessageContent(agentMessage.id, fullContent + ' …', false);
        this.emitDone(conversationId, agentMessage.id, fullContent + ' …');
      } else {
        // Stay silent on continuation errors to avoid noise
        updateMessageContent(agentMessage.id, fullContent, false);
        if (fullContent) this.emitDone(conversationId, agentMessage.id, fullContent);
      }
    } finally {
      releaseStream(key);
    }
  }
}
