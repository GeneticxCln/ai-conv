import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { MessageBubble } from './MessageBubble';
import { InputBar } from './InputBar';
import { PersonaModal } from './PersonaModal';
import { SettingsModal } from './SettingsModal';
import { LoginModal } from './LoginModal';
import { MessageSquare, Plus, Settings, X, Menu, CheckCircle, Circle, Pencil } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSocket } from '../hooks/useSocket';
import { Persona } from '@ai-conv/types';

export function Chat() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const currentMessages = useChatStore((s) =>
    s.currentConversationId ? s.messages[s.currentConversationId] || [] : []
  );
  const agents = useChatStore((s) => s.agents);
  const [searchQuery, setSearchQuery] = useState('');
  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const currentUser = useChatStore((s) => s.currentUser);
  const setCurrentUser = useChatStore((s) => s.setCurrentUser);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const toggleAgent = useChatStore((s) => s.toggleAgent);

  const {
    connected,
    sendMessage,
    stopGeneration,
    joinConversation,
    loadOlderMessages,
    leaveConversation,
    createPersona,
    updatePersona,
    deletePersona,
    createConversation,

    clearConversations,
    getModelsFull: getModelsFullFn,
    getGpuInfo,
    pullModel,
    listUsers,
    createUser,
    selectUser,
    deleteExistingUser,

    deleteMessage,
    regenerateMessage,

    exportData,
    importData,
  } = useSocket();

  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string; avatar?: string; createdAt: string }[]>([]);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [personaModal, setPersonaModal] = useState<{ open: boolean; editing: Persona | null }>({ open: false, editing: null });
  const streamingCount = useChatStore((s) => Object.keys(s.streamingMessages).length);
  const awaitingFirstToken = useChatStore((s) =>
    currentConversationId ? Boolean(s.awaitingFirstToken[currentConversationId]) : false
  );
  const currentConv = conversations.find((c) => c.id === currentConversationId);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  // Autoscroll only while the user is already near the bottom; never yank the
  // viewport while they are reading history mid-stream.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 160) {
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [currentMessages]);

  // Load the next older page when the user scrolls to the top.
  const loadingOlderRef = useRef(false);
  const hasAllHistoryRef = useRef(false);
  const handleScroll = async () => {
    const el = scrollContainerRef.current;
    if (!el || !currentConversationId) return;
    if (el.scrollTop > 40 || loadingOlderRef.current || hasAllHistoryRef.current) return;
    loadingOlderRef.current = true;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    const gotMore = await loadOlderMessages(currentConversationId);
    hasAllHistoryRef.current = !gotMore;
    // Keep the viewport anchored on the same content after prepend.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - prevHeight + prevTop;
    });
    loadingOlderRef.current = false;
  };

  useEffect(() => {
    hasAllHistoryRef.current = false;
    loadingOlderRef.current = false;
  }, [currentConversationId]);

  useEffect(() => {
    if (currentConversationId) {
      joinConversation(currentConversationId);
    }
    // Clear any stale streaming state when switching conversations
    stopStreaming('');
    return () => {
      if (currentConversationId) {
        leaveConversation(currentConversationId);
        // Don't leave a stale "loading model" indicator behind for a
        // conversation the user has navigated away from.
        useChatStore.getState().setAwaitingFirstToken(currentConversationId, false);
      }
    };
  }, [currentConversationId, joinConversation, leaveConversation, stopStreaming]);

  const [sendError, setSendError] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);

  const handleSend = (content: string): boolean => {
    if (!currentConversationId) return false;
    const tempId = crypto.randomUUID();
    // Optimistically render user message immediately
    useChatStore.getState().addMessage(currentConversationId, {
      id: tempId,
      conversationId: currentConversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      isStreaming: false,
    });
    const ok = sendMessage(currentConversationId, content, {
      agentChat: useChatStore.getState().agentChat,
      tempId,
    });
    setSendError(!ok);
    return ok;
  };

  const handleNewConversation = async () => {
    setConversationError(null);
    const created = await createConversation();
    if (!created) {
      setConversationError(
        connected
          ? 'Conversation could not be created. Check your profile session and connection.'
          : 'Conversation could not be created while disconnected.',
      );
    }
    return created;
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">AI Conv</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Multi-Persona Messenger</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* User chip */}
          <button
            onClick={async () => {
              const availableUsers = await listUsers();
              setUsers(availableUsers);
              setCurrentUser(null);
            }}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Switch profile"
          >
            <span className="text-base">{currentUser?.avatar || '🙂'}</span>
            <span className="hidden sm:block text-xs font-medium text-gray-600 dark:text-gray-300">
              {currentUser?.name || 'Guest'}
            </span>
          </button>

          <div className="flex items-center gap-1.5 mr-1">
            <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')} />
            <span className="hidden sm:block text-xs text-gray-500 dark:text-gray-400">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={() => { setLeftDrawer(true); listUsers().then(setUsers); }}
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            title="Conversations"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Mobile left drawer */}
        {leftDrawer && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setLeftDrawer(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-white dark:bg-gray-800 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-medium text-gray-900 dark:text-gray-100">Conversations</h2>
                <button onClick={() => setLeftDrawer(false)} className="p-1 text-gray-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="overflow-y-auto p-2 space-y-1 max-h-[calc(100vh-160px)]">
                {filteredConversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { setCurrentConversation(conv.id); setLeftDrawer(false); }}
                    className={cn(
                      'w-full p-3 rounded-lg text-left',
                      currentConversationId === conv.id ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    )}
                  >
                    <p className="text-sm font-medium truncate text-gray-800 dark:text-gray-100">{conv.title}</p>
                  </button>
                ))}
              </div>
              <div className="p-3 border-t border-gray-200 dark:border-gray-700">
                <button onClick={async () => { if (await handleNewConversation()) setLeftDrawer(false); }} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg">
                  <Plus className="w-4 h-4" /> New Conversation
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main chat area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Conversation header - includes search on desktop */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 hidden lg:block">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {/* Conversation header */}
          {currentConversationId && (
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <h2 className="font-medium text-gray-900 dark:text-gray-100 truncate">{currentConv?.title || 'Conversation'}</h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {currentMessages.filter(m => m.role === 'agent').length} responses
                </span>
              </div>

            </div>
          )}

          {/* Persona bar — always visible above chat */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap mr-1">
                {agents.filter(a => a.enabled).length}/{agents.length}
              </span>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors',
                    agent.enabled
                      ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600'
                  )}
                >
                  <span className="text-sm">{agent.avatar || agent.name[0]}</span>
                  <span className="max-w-[80px] truncate">{agent.name}</span>
                  {agent.enabled ? <CheckCircle className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                  <span
                    onClick={(e) => { e.stopPropagation(); setPersonaModal({ open: true, editing: agent }); }}
                    className="ml-1 hover:text-blue-500"
                  >
                    <Pencil className="w-3 h-3" />
                  </span>
                </button>
              ))}
              <button
                onClick={() => setPersonaModal({ open: true, editing: null })}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4" ref={scrollContainerRef} onScroll={handleScroll}>
            {currentMessages.length === 0 && !currentConversationId && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                <MessageSquare className="w-16 h-16 mb-4 opacity-50" />
                <h3 className="text-lg font-medium">No conversation selected</h3>
                <p className="text-sm">Create or select a conversation to start chatting</p>
                <button onClick={() => { void handleNewConversation(); }} className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg">
                  <Plus className="w-4 h-4 mr-2" /> New Conversation
                </button>
              </div>
            )}

            {currentMessages.length === 0 && currentConversationId && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
                <MessageSquare className="w-16 h-16 mb-4 opacity-50" />
                <h3 className="text-lg font-medium">No messages yet</h3>
                <p className="text-sm">Start the conversation!</p>
              </div>
            )}

            {currentMessages.length > 0 && (
              <>
                {currentMessages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    canRegenerate={i === currentMessages.length - 1 && msg.role === 'agent' && !msg.isStreaming}
                    onDelete={deleteMessage}
                    onRegenerate={regenerateMessage}
                  />
                ))}
                <div ref={messagesEndRef} />
              </>
            )}

            {awaitingFirstToken && (
              <div className="px-4 pb-1 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="inline-block w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" aria-hidden="true" />
                <span>
                  Loading model… first response can take a while on larger models.
                </span>
                {currentConversationId && (
                  <button
                    onClick={() => stopGeneration(currentConversationId)}
                    className="ml-2 px-3 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
            {streamingCount > 0 && (
              <div className="px-4 pb-1 flex justify-center">
                <button
                  onClick={() => currentConversationId && stopGeneration(currentConversationId)}
                  className="px-4 py-1.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60"
                >
                  Stop generating
                </button>
              </div>
            )}
            {conversationError && (
              <div className="px-4 pb-1 flex justify-center">
                <span className="text-xs text-red-500 dark:text-red-400">
                  {conversationError}
                </span>
              </div>
            )}
            {sendError && (
              <div className="px-4 pb-1 flex justify-center">
                <span className="text-xs text-red-500 dark:text-red-400">
                  Message not sent — connection lost. Your draft is preserved.
                </span>
              </div>
            )}
          </div>

          {/* Keep the composer outside the scrollable message history so it
              remains fixed at the bottom while messages grow upward. */}
          <div className="shrink-0 bg-white dark:bg-gray-800">
            <InputBar onSend={handleSend} disabled={!currentConversationId || !connected} />
          </div>
        </main>
      </div>

      {/* Persona modal */}
      <PersonaModal
        key={personaModal.open ? `open-${personaModal.editing?.id || 'new'}` : 'closed'}
        open={personaModal.open}
        editing={personaModal.editing}
        getModels={getModelsFullFn}
        getGpuInfo={getGpuInfo}
        pullModel={pullModel}
        onClose={() => setPersonaModal({ open: false, editing: null })}
        onSave={(data) => {
          if (personaModal.editing) updatePersona(personaModal.editing.id, data);
          else createPersona(data);
        }}
        onDelete={deletePersona}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onClearConversations={clearConversations}
        getModels={getModelsFullFn}
        getGpuInfo={getGpuInfo}
        pullModel={pullModel}
        exportData={exportData}
        importData={importData}
      />

      <LoginModal
        key={currentUser ? 'picked' : `open-${users.length > 0 ? 'users' : 'empty'}`}
        open={!currentUser}
        users={users}
        onPick={async (user) => {
          const selected = await selectUser(user.id);
          if (selected) setCurrentUser(selected);
        }}
        onCreate={async (name, avatar) => {
          const created = await createUser(name, avatar);
          if (created) setCurrentUser(created);
          return created;
        }}
        onDeleteUser={(id) => {
          deleteExistingUser(id);
          if (currentUser?.id === id) setCurrentUser(null);
          listUsers().then(setUsers);
        }}
      />

    </div>
  );
}
