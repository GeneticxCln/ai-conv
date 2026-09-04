import { Message } from './types';

/** Maximum number of history messages to send to the LLM. */
export const MAX_HISTORY = 40;

/**
 * Truncate conversation history to the most recent `limit` messages.
 * Returns the full array when it is already within the limit.
 */
export function truncateHistory(messages: Message[], limit = MAX_HISTORY): Message[] {
  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}
