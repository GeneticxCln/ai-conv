import { useCallback } from 'react';
import { Conversation, User, Persona, Message } from '@ai-conv/types';
import { useChatStore } from '../stores/useChatStore';
import { InstalledModel } from '../lib/modelPicker';

interface UseSocketActionsOptions {
  emit: (event: string, payload?: any) => void;
  emitWithAck: <T>(event: string, payload?: any, timeout?: number) => Promise<T>;
  applyAuthToken: (token: string) => Promise<void>;
  connected: boolean;
}

interface AuthResult {
  ok?: boolean;
  error?: string;
  user?: User;
  token?: string;
}

export function useSocketActions({ emit, emitWithAck, applyAuthToken, connected }: UseSocketActionsOptions) {
  const joinConversation = useCallback((conversationId: string) => {
    if (connected) emit('join', conversationId);
  }, [emit, connected]);

  const leaveConversation = useCallback((conversationId: string) => {
    if (connected) emit('leave', conversationId);
  }, [emit, connected]);

  const loadOlderMessages = useCallback(async (conversationId: string): Promise<boolean> => {
    if (!connected) return false;
    const existing = useChatStore.getState().messages[conversationId] || [];
    const before = existing[0]?.id;
    try {
      const page = await emitWithAck<{ ok?: boolean; hasMore?: boolean; messages?: Message[] }>(
        'messages:older',
        { conversationId, before },
        5000,
      );
      // The event handler normally performs the prepend. This fallback covers
      // transports that preserve acks but drop event notifications.
      if (page?.messages?.length) {
        useChatStore.getState().prependMessages(conversationId, page.messages);
      }
      return Boolean(page?.hasMore);
    } catch {
      return false;
    }
  }, [emitWithAck, connected]);

  const sendMessage = useCallback((conversationId: string, content: string, options?: { agentChat?: boolean; tempId?: string }): boolean => {
    if (!connected) return false;
    emit('user:message', {
      conversationId,
      content,
      agentChat: options?.agentChat,
      tempId: options?.tempId,
    });
    return true;
  }, [emit, connected]);

  const stopGeneration = useCallback((conversationId: string) => {
    if (connected) emit('generation:stop', conversationId);
  }, [emit, connected]);

  const toggleAgent = useCallback((id: string) => {
    if (connected) emit('persona:toggle', id);
  }, [emit, connected]);

  const createPersona = useCallback(async (data: Partial<Persona>) => {
    if (connected) emit('persona:create', data);
  }, [emit, connected]);

  const updatePersona = useCallback((id: string, patch: Partial<Persona>) => {
    if (connected) emit('persona:update', { id, patch });
  }, [emit, connected]);

  const deletePersona = useCallback((id: string) => {
    if (connected) emit('persona:delete', id);
  }, [emit, connected]);

  const getModels = useCallback(async (): Promise<string[]> => {
    if (!connected) return [];
    try { return await emitWithAck<string[]>('models:list', undefined, 5000); } catch { return []; }
  }, [emitWithAck, connected]);

  const getModelsFull = useCallback(async (): Promise<InstalledModel[]> => {
    if (!connected) return [];
    try { return await emitWithAck<InstalledModel[]>('models:list:full', undefined, 5000); } catch { return []; }
  }, [emitWithAck, connected]);

  const pullModel = useCallback((modelName: string) => {
    if (connected) emit('model:pull', modelName);
  }, [emit, connected]);

  const createConversation = useCallback(async (title?: string): Promise<Conversation | null> => {
    if (!connected) return null;
    try {
      // Send an explicit null title so socket.io places the acknowledgement
      // callback in the backend handler's second argument in both transports.
      const result = await emitWithAck<{
        ok?: boolean;
        error?: string;
        conversation?: Conversation;
      }>('conversation:create', title?.trim() || null, 8000);
      if (!result?.ok || !result.conversation) return null;

      // The server also emits conversation:created. This local fallback keeps
      // the UI correct if that notification is missed during bridge startup.
      const conversation = result.conversation;
      const state = useChatStore.getState();
      if (!state.conversations.some((item) => item.id === conversation.id)) {
        state.addConversation(conversation);
      }
      state.setCurrentConversation(conversation.id);
      return conversation;
    } catch {
      return null;
    }
  }, [emitWithAck, connected]);

  const deleteConversation = useCallback((id: string) => {
    if (connected) emit('conversation:delete', id);
  }, [emit, connected]);

  const renameConversation = useCallback((id: string, title: string) => {
    if (connected) emit('conversation:rename', { id, title: title.trim().slice(0, 120) });
  }, [emit, connected]);

  const clearConversations = useCallback(() => {
    if (connected) emit('conversations:clear');
  }, [emit, connected]);

  const listUsers = useCallback(async (): Promise<User[]> => {
    if (!connected) return [];
    try { return await emitWithAck<User[]>('users:list', undefined, 8000); } catch { return []; }
  }, [emitWithAck, connected]);

  const applyUserToken = useCallback(async (result: AuthResult): Promise<User | null> => {
    if (!result?.token || !result.user) return null;
    await applyAuthToken(result.token);
    return result.user;
  }, [applyAuthToken]);

  const createUser = useCallback(async (name: string, avatar?: string): Promise<User | null> => {
    if (!connected) return null;
    try {
      const result = await emitWithAck<AuthResult>('user:create', { name, avatar }, 8000);
      return await applyUserToken(result);
    } catch {
      return null;
    }
  }, [emitWithAck, connected, applyUserToken]);

  const selectUser = useCallback(async (id: string): Promise<User | null> => {
    if (!connected) return null;
    try {
      const result = await emitWithAck<AuthResult>('user:select', id, 8000);
      return await applyUserToken(result);
    } catch {
      return null;
    }
  }, [emitWithAck, connected, applyUserToken]);

  const deleteExistingUser = useCallback((id: string) => {
    if (connected) emit('user:delete', id);
  }, [emit, connected]);

  const setParticipants = useCallback((conversationId: string, personaIds: string[]) => {
    if (connected) emit('participants:set', { conversationId, personaIds });
  }, [emit, connected]);

  const deleteMessage = useCallback((id: string) => {
    if (connected) emit('message:delete', id);
  }, [emit, connected]);

  const regenerateMessage = useCallback((id: string) => {
    if (connected) emit('message:regenerate', id);
  }, [emit, connected]);

  const importConversation = useCallback(async (data: { title: string; messages: Array<{ role: string; content: string; agentName?: string }> }): Promise<Conversation | null> => {
    if (!connected) return null;
    try {
      const result = await emitWithAck<{ ok?: boolean; conversation?: Conversation }>('conversation:import', data, 15000);
      return result?.conversation || null;
    } catch { return null; }
  }, [emitWithAck, connected]);

  const exportData = useCallback(async (): Promise<{
    conversations: Conversation[];
    messages: Message[];
    personas: Persona[];
    settings: { theme: string; agentChat: boolean };
  } | null> => {
    if (!connected) return null;
    try { return await emitWithAck('data:export', undefined, 10000); } catch { return null; }
  }, [emitWithAck, connected]);

  const importData = useCallback(async (file: File): Promise<{ ok: boolean; error?: string }> => {
    if (!connected) return { ok: false, error: 'Not connected' };
    try {
      const data = JSON.parse(await file.text());
      return await emitWithAck('data:import', data, 15000);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Import failed' };
    }
  }, [emitWithAck, connected]);

  return {
    joinConversation,
    leaveConversation,
    loadOlderMessages,
    sendMessage,
    stopGeneration,
    toggleAgent,
    createPersona,
    updatePersona,
    deletePersona,
    getModels,
    getModelsFull,
    pullModel,
    createConversation,
    deleteConversation,
    renameConversation,
    clearConversations,
    listUsers,
    createUser,
    selectUser,
    deleteExistingUser,
    setParticipants,
    deleteMessage,
    regenerateMessage,
    importConversation,
    exportData,
    importData,
  };
}
