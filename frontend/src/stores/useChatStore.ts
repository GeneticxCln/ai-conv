import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Message, Conversation, Persona, User } from '@ai-conv/types';

interface ChatState {
  // Connection
  connected: boolean;
  setConnected: (connected: boolean) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // Agent-to-agent chat
  agentChat: boolean;
  setAgentChat: (v: boolean) => void;

  // Current user (local profiles)
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;

  // Conversations
  conversations: Conversation[];
  currentConversationId: string | null;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  setCurrentConversation: (id: string | null) => void;
  removeConversation: (id: string) => void;
  clearAllConversations: () => void;

  // Messages
  messages: Record<string, Message[]>;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  prependMessages: (conversationId: string, older: Message[]) => void;

  // Agents
  agents: Persona[];
  setAgents: (agents: Persona[]) => void;
  toggleAgent: (agentId: string) => void;

  // Streaming state
  streamingMessages: Record<string, string>; // messageId -> agentId
  startStreaming: (messageId: string, agentId: string) => void;
  stopStreaming: (messageId: string) => void;

  // Model pulls
  pullProgress: Record<string, { status: string; percent: number | null; _ts: number }>;
  setPullProgress: (model: string, p: { status: string; percent: number | null }) => void;
  clearStalePullProgress: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      // Connection
      connected: false,
      setConnected: (connected) => set({ connected }),

      // Theme
      theme: 'light',
      setTheme: (theme) => set({ theme }),

      // Agent-to-agent
      agentChat: false,
      setAgentChat: (agentChat) => set({ agentChat }),

      // Current user
      currentUser: null,
      setCurrentUser: (currentUser) => set({ currentUser }),

      // Conversations
      conversations: [],
      currentConversationId: null,
      setConversations: (conversations) => set({ conversations }),
      addConversation: (conversation) =>
        set((state) => ({ conversations: [conversation, ...state.conversations] })),
      setCurrentConversation: (currentConversationId) => set({ currentConversationId }),
      removeConversation: (id) =>
        set((state) => {
          const conversations = state.conversations.filter((c) => c.id !== id);
          const messages = { ...state.messages };
          delete messages[id];
          const currentConversationId =
            state.currentConversationId === id ? conversations[0]?.id || null : state.currentConversationId;
          return { conversations, messages, currentConversationId };
        }),
      clearAllConversations: () =>
        set({ conversations: [], messages: {}, currentConversationId: null }),

      // Messages
      messages: {},
      addMessage: (conversationId, message) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: [...(state.messages[conversationId] || []), message],
          },
        })),
      updateMessage: (conversationId, messageId, updates) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] || []).map((m) =>
              m.id === messageId ? { ...m, ...updates } : m
            ),
          },
        })),
      removeMessage: (conversationId, messageId) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] || []).filter((m) => m.id !== messageId),
          },
        })),
      setMessages: (conversationId, messages) =>
        set((state) => ({
          messages: { ...state.messages, [conversationId]: messages },
        })),
      prependMessages: (conversationId, older) =>
        set((state) => {
          const existing = state.messages[conversationId] || [];
          const known = new Set(existing.map((m) => m.id));
          const fresh = older.filter((m) => !known.has(m.id));
          return { messages: { ...state.messages, [conversationId]: [...fresh, ...existing] } };
        }),
      // Agents
      agents: [],
      setAgents: (agents) => set({ agents }),
      toggleAgent: (agentId) =>
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId ? { ...a, enabled: !a.enabled } : a
          ),
        })),

      // Streaming
      streamingMessages: {},
      startStreaming: (messageId, agentId) =>
        set((state) => ({
          streamingMessages: { ...state.streamingMessages, [messageId]: agentId },
        })),
      stopStreaming: (messageId) =>
        set((state) => {
          if (!messageId) return { streamingMessages: {} };
          const { [messageId]: _, ...rest } = state.streamingMessages;
          return { streamingMessages: rest };
        }),

      // Model pulls
      pullProgress: {},
      setPullProgress: (model, p) =>
        set((state) => {
          const now = Date.now();
          const filtered = Object.fromEntries(
            Object.entries(state.pullProgress).filter(([, v]) => now - (v._ts ?? 0) < 600000) // 10 min TTL
          );
          return { pullProgress: { ...filtered, [model]: { ...p, _ts: now } } };
        }),
      clearStalePullProgress: () =>
        set((state) => {
          const now = Date.now();
          const filtered = Object.fromEntries(
            Object.entries(state.pullProgress).filter(([, v]) => now - (v._ts ?? 0) < 600000)
          );
          return { pullProgress: filtered };
        }),
    }),
    {
      name: 'ai-conv-chat',
      version: 1,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<ChatState>;
        if (version < 1) {
          // v0 -> v1: drop legacy fields that no longer match current types.
          delete (p as Record<string, unknown>).streamingMessages;
          delete (p as Record<string, unknown>).messages;
        }
        return {
          agents: Array.isArray(p.agents) ? p.agents : [],
          theme: p.theme === 'dark' ? 'dark' : 'light',
          agentChat: Boolean(p.agentChat),
          currentUser: p.currentUser && typeof p.currentUser.id === 'string' ? p.currentUser : null,
        } as ChatState;
      },
      partialize: (state) => ({
        agents: state.agents,
        theme: state.theme,
        agentChat: state.agentChat,
        currentUser: state.currentUser,
      }),
    }
  )
);
