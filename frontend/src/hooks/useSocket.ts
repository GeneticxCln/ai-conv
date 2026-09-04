import { useSocketConnection } from './useSocketConnection';
import { useSocketEvents } from './useSocketEvents';
import { useSocketActions } from './useSocketActions';
import { useChatStore } from '../stores/useChatStore';

/**
 * Main socket hook - combines connection, events, and actions.
 * This is the primary hook components should use.
 */
export function useSocket() {
  const currentConversationId = useChatStore((s) => s.currentConversationId);

  // Connection management
  const connection = useSocketConnection();

  // Event handlers (updates store from incoming events)
  useSocketEvents({
    onEvent: connection.onEvent,
    emitWithAck: connection.emitWithAck,
    connected: connection.connected,
    usingBridge: connection.usingBridge,
    currentConversationId,
  });

  // Actions (outgoing emits)
  const actions = useSocketActions({
    emit: connection.emit,
    emitWithAck: connection.emitWithAck,
    applyAuthToken: connection.applyAuthToken,
    connected: connection.connected,
  });

  // Return combined API
  return {
    // Connection state
    connected: connection.connected,
    usingBridge: connection.usingBridge,

    // Connection control
    connect: connection.connect,
    disconnect: connection.disconnect,

    // All actions
    ...actions,
  };
}
