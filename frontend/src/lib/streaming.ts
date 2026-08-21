import { Message, AgentTokenPayload } from '../types';

/**
 * Pure reducer for agent token streaming: given the current messages for a
 * conversation and an incoming `agent:token` payload, return the next message
 * list. Extracted from useSocket so it can be unit-tested without a socket.
 */
export function applyAgentToken(
  messages: Message[],
  payload: AgentTokenPayload,
  now: () => string = () => new Date().toISOString()
): Message[] {
  const { messageId, agentId, agentName, token, isDone } = payload;

  if (isDone) {
    // Completion is handled by `agent:done`; tokens carry no content here.
    return messages;
  }

  const existing = messages.find((m) => m.id === messageId);

  if (!existing) {
    const newMessage: Message = {
      id: messageId,
      conversationId: payload.conversationId,
      role: 'agent',
      content: token,
      agentId,
      agentName,
      createdAt: now(),
      isStreaming: true,
    };
    return [...messages, newMessage];
  }

  return messages.map((m) =>
    m.id === messageId ? { ...m, content: m.content + token, isStreaming: true } : m
  );
}
