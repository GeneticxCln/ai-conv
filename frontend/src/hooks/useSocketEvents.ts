import { useEffect } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { Message, Persona, Conversation, User, AgentTokenPayload, AgentDonePayload, AgentErrorPayload } from '@ai-conv/types';
import { applyAgentToken } from '../lib/streaming';

interface UseSocketEventsOptions {
  onEvent: (event: string, callback: (payload: any) => void) => () => void;
  emitWithAck: <T>(event: string, payload?: any, timeout?: number) => Promise<T>;
  connected: boolean;
  usingBridge: boolean;
  currentConversationId: string | null;
}

export function useSocketEvents({ onEvent, emitWithAck, connected, usingBridge, currentConversationId }: UseSocketEventsOptions) {
  const {
    setAgents,
    setConversations,
    setCurrentConversation,
    setMessages,
    addMessage,
    prependMessages,
    updateMessage,
    removeConversation,
    clearAllConversations,
    removeMessage,
    startStreaming,
    stopStreaming,
    setPullProgress,
    setCurrentUser,
  } = useChatStore();

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(onEvent('user:current', (user: any) => setCurrentUser(user)));

    // The connection can authenticate before this effect installs its event
    // listeners. Reconcile through an ack as well so a missed user:current
    // event cannot leave the profile modal open for an authenticated token.
    if (connected && !usingBridge) {
      void emitWithAck<User>('session:current', undefined, 5000)
        .then((user) => {
          if (user?.id) setCurrentUser(user);
        })
        .catch(() => {
          // Anonymous bootstrap connections are expected to reject this call.
        });
    }

    unsubs.push(onEvent('personas:list', (personas: Persona[]) => setAgents(personas)));
    unsubs.push(onEvent('conversation:list', (conversations: Conversation[]) => setConversations(conversations)));
    unsubs.push(onEvent('conversation:created', (conversation: Conversation) => setCurrentConversation(conversation.id)));

    unsubs.push(onEvent('messages:history', ({ conversationId, messages }: { conversationId: string; messages: Message[] }) => {
      setMessages(conversationId, messages);
    }));

    // The server emits this event as well as acknowledging the request. The
    // reducer deduplicates by message id so retries cannot duplicate history.
    unsubs.push(onEvent('messages:older', ({ conversationId, messages }: { conversationId: string; messages: Message[] }) => {
      prependMessages(conversationId, messages);
    }));

    unsubs.push(onEvent('conversation:deleted', (id: string) => removeConversation(id)));
    unsubs.push(onEvent('conversations:cleared', () => clearAllConversations()));
    unsubs.push(onEvent('model:pull:progress', (p: { model: string; status: string; percent: number | null }) => {
      setPullProgress(p.model, { status: p.status, percent: p.percent });
    }));
    unsubs.push(onEvent('message:deleted', ({ conversationId, id }: { conversationId: string; id: string }) => {
      removeMessage(conversationId, id);
    }));

    unsubs.push(onEvent('agent:token', (payload: AgentTokenPayload) => {
      const current = useChatStore.getState().messages[payload.conversationId] || [];
      setMessages(payload.conversationId, applyAgentToken(current, payload));
      if (payload.isDone) stopStreaming(payload.messageId);
      else startStreaming(payload.messageId, payload.agentId);
    }));

    unsubs.push(onEvent('agent:done', (payload: AgentDonePayload) => {
      stopStreaming(payload.messageId);
      updateMessage(payload.conversationId, payload.messageId, {
        content: payload.fullContent,
        isStreaming: false,
      });
    }));

    unsubs.push(onEvent('agent:error', (payload: AgentErrorPayload) => {
      if (payload.conversationId === currentConversationId) {
        console.error(`Agent error (${payload.agentName}):`, payload.error);
      }
      stopStreaming('');
      const msgs = useChatStore.getState().messages[payload.conversationId] || [];
      if (msgs.some((m) => m.isStreaming)) {
        setMessages(
          payload.conversationId,
          msgs.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        );
      }
    }));

    const clearUserOnAuthFailure = (payload: { error?: string }) => {
      console.error('Socket authorization error:', payload?.error || 'Authentication required');
      setCurrentUser(null);
    };
    unsubs.push(onEvent('auth:error', clearUserOnAuthFailure));

    unsubs.push(onEvent('message:created', (message: Message) => {
      const existing = useChatStore.getState().messages[message.conversationId] || [];
      if (existing.some((m) => m.id === message.id)) return;
      addMessage(message.conversationId, message);
    }));
    unsubs.push(onEvent('generation:stopped', (conversationId: string) => {
      stopStreaming('');
      const msgs = useChatStore.getState().messages[conversationId] || [];
      if (msgs.some((m) => m.isStreaming)) {
        setMessages(
          conversationId,
          msgs.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        );
      }
    }));

    return () => {
      for (const unsub of unsubs) {
        try { unsub(); } catch { /* ignore */ }
      }
    };
  }, [
    onEvent,
    emitWithAck,
    connected,
    usingBridge,
    currentConversationId,
    setAgents,
    setConversations,
    setCurrentConversation,
    setMessages,
    prependMessages,
    addMessage,
    updateMessage,
    removeConversation,
    clearAllConversations,
    removeMessage,
    startStreaming,
    stopStreaming,
    setPullProgress,
    setCurrentUser,
  ]);
}
