import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useChatStore } from '../stores/useChatStore';
import { Message, AgentTokenPayload, AgentDonePayload, AgentErrorPayload, Persona, User, Conversation } from '../types';
import { applyAgentToken } from '../lib/streaming';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

// ============ Socket Hook ============
export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const {
    setConnected,
    updateMessage,
    setMessages,
    setAgents,
    setConversations,
    addConversation,
    setCurrentConversation,
    removeConversation,
    clearAllConversations,
    removeMessage,
    startStreaming,
    stopStreaming,
    currentConversationId,
  } = useChatStore();

  // Socket lifecycle: connect once per mount; never re-runs on conversation switch.
  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setConnected(true);
      // Request initial data
      socket.emit('personas:list');
      socket.emit('conversation:list');
      if (useChatStore.getState().currentConversationId) {
        socket.emit('join', useChatStore.getState().currentConversationId);
      } else {
        socket.emit('conversation:create');
      }
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setConnected(false);
    });

    // Personas
    socket.on('personas:list', (personas: Persona[]) => {
      setAgents(personas);
    });

    // Conversations
    socket.on('conversation:list', (conversations: any[]) => {
      setConversations(conversations);
    });

    socket.on('conversation:created', (conversation: any) => {
      addConversation(conversation);
      setCurrentConversation(conversation.id);
      socket.emit('join', conversation.id);
    });

    socket.on('messages:history', ({ conversationId, messages }: { conversationId: string; messages: Message[] }) => {
      setMessages(conversationId, messages);
    });

    socket.on('conversation:deleted', (id: string) => {
      removeConversation(id);
    });

    socket.on('conversations:cleared', () => {
      clearAllConversations();
    });

    socket.on('model:pull:progress', (p: { model: string; status: string; percent: number | null }) => {
      useChatStore.getState().setPullProgress(p.model, { status: p.status, percent: p.percent });
    });

    socket.on('message:deleted', ({ conversationId, id }: { conversationId: string; id: string }) => {
      removeMessage(conversationId, id);
    });

    // Messages - Agent token streaming (pure reducer in lib/streaming.ts)
    socket.on('agent:token', (payload: AgentTokenPayload) => {
      const { conversationId, messageId, agentId, isDone } = payload;

      if (isDone) {
        // Message complete - content update handled by agent:done
        stopStreaming(messageId);
        return;
      }

      const existing = useChatStore.getState().messages[conversationId] || [];
      const next = applyAgentToken(existing, payload);
      setMessages(conversationId, next);

      if (next.length > existing.length) {
        startStreaming(messageId, agentId);
      }
    });

    socket.on('agent:done', (payload: AgentDonePayload) => {
      const { conversationId, messageId, fullContent } = payload;
      updateMessage(conversationId, messageId, {
        content: fullContent,
        isStreaming: false,
      });
      stopStreaming(messageId);
    });

    socket.on('agent:error', (payload: AgentErrorPayload) => {
      const { conversationId, agentId, error } = payload;
      // Find streaming message for this agent and mark error
      const messages = useChatStore.getState().messages[conversationId] || [];
      const streamingMsg = messages.find(
        (m) => m.agentId === agentId && m.isStreaming
      );
      if (streamingMsg) {
        updateMessage(conversationId, streamingMsg.id, {
          content: `[Error: ${error}]`,
          isStreaming: false,
        });
        stopStreaming(streamingMsg.id);
      }
    });

    return () => {
      socket.disconnect();
    };
    // Handlers close over store actions (stable) and read live state via
    // getState(); the socket must connect once per mount, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Room membership: re-join the current conversation after reconnect.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onConnect = () => {
      if (currentConversationId) socket.emit('join', currentConversationId);
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [currentConversationId]);

  // ============ Actions ============
  const sendMessage = useCallback((conversationId: string, content: string, opts?: { agentChat?: boolean }): boolean => {
    if (!socketRef.current?.connected) return false;
    socketRef.current.emit('user:message', { conversationId, content, agentChat: opts?.agentChat });
    return true;
  }, []);

  const joinConversation = useCallback((conversationId: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('join', conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('leave', conversationId);
  }, []);

  const toggleAgent = useCallback((agentId: string) => {
    if (!socketRef.current?.connected) return;
    const p = useChatStore.getState().agents.find(a => a.id === agentId);
    if (p) socketRef.current.emit('persona:update', { id: agentId, patch: { enabled: !p.enabled } });
  }, []);

  const createPersona = useCallback((data: Partial<Persona>) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('persona:create', data);
  }, []);

  const updatePersona = useCallback((id: string, patch: Partial<Persona>) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('persona:update', { id, patch });
  }, []);

  const deletePersona = useCallback((id: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('persona:delete', id);
  }, []);

  const getModels = useCallback(async (): Promise<string[]> => {
    if (!socketRef.current?.connected) return [];
    try {
      return await socketRef.current.emitWithAck('models:list');
    } catch {
      return [];
    }
  }, []);

  const createConversation = useCallback((title?: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('conversation:create', title);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('conversation:delete', id);
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('conversation:rename', { id, title });
  }, []);

  const clearConversations = useCallback(() => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('conversations:clear');
  }, []);

  const stopGeneration = useCallback((conversationId: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('generation:stop', conversationId);
  }, []);

  const pullModel = useCallback((modelName: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('model:pull', modelName);
  }, []);

  const listUsers = useCallback(async (): Promise<User[]> => {
    if (!socketRef.current?.connected) return [];
    try { return await socketRef.current.emitWithAck('users:list'); } catch { return []; }
  }, []);

  const createUser = useCallback(async (name: string, avatar?: string): Promise<User | null> => {
    if (!socketRef.current?.connected) return null;
    try { return await socketRef.current.emitWithAck('user:create', { name, avatar }); } catch { return null; }
  }, []);

  const deleteExistingUser = useCallback((id: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('user:delete', id);
  }, []);

  const setParticipants = useCallback((conversationId: string, personaIds: string[]) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('participants:set', { conversationId, personaIds });
  }, []);

  const deleteMessage = useCallback((id: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('message:delete', id);
  }, []);

  const regenerateMessage = useCallback((id: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('message:regenerate', id);
  }, []);

  const importConversation = useCallback(async (data: { title: string; messages: Array<{ role: string; content: string; agentName?: string }> }): Promise<Conversation | null> => {
    if (!socketRef.current?.connected) return null;
    try { return await socketRef.current.emitWithAck('conversation:import', data); } catch { return null; }
  }, []);

  return {
    sendMessage,
    joinConversation,
    leaveConversation,
    toggleAgent,
    createPersona,
    updatePersona,
    deletePersona,
    getModels,
    createConversation,
    deleteConversation,
    renameConversation,
    clearConversations,
    stopGeneration,
    pullModel,
    listUsers,
    createUser,
    deleteExistingUser,
    setParticipants,
    deleteMessage,
    regenerateMessage,
    importConversation,
  };
}
