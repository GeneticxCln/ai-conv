import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Message, Conversation, Persona, User } from '../types';

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

  // Agents
  agents: Persona[];
  setAgents: (agents: Persona[]) => void;
  toggleAgent: (agentId: string) => void;

  // Streaming state
  streamingMessages: Record<string, string>; // messageId -> agentId
  startStreaming: (messageId: string, agentId: string) => void;
  stopStreaming: (messageId: string) => void;

  // Model pulls
  pullProgress: Record<string, { status: string; percent: number | null }>;
  setPullProgress: (model: string, p: { status: string; percent: number | null }) => void;
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
          const { [messageId]: _, ...rest } = state.streamingMessages;
          return { streamingMessages: rest };
        }),

      // Model pulls
      pullProgress: {},
      setPullProgress: (model, p) =>
        set((state) => ({
          pullProgress: { ...state.pullProgress, [model]: p },
        })),
    }),
    {
      name: 'ai-conv-chat',
      partialize: (state) => ({
        agents: state.agents,
        theme: state.theme,
        agentChat: state.agentChat,
        currentUser: state.currentUser,
      }),
    }
  )
);
