import { useEffect, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { ConversationPane } from './ConversationPane';
import { PersonaModal } from './PersonaModal';
import { SettingsModal } from './SettingsModal';
import { LoginModal } from './LoginModal';
import { MessageSquare, Plus, Settings, X, Menu, Pencil, Search, Columns2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSocket } from '../hooks/useSocket';
import { Persona } from '@ai-conv/types';
import { SearchPalette } from './SearchPalette';

export function Chat() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const openTabIds = useChatStore((s) => s.openTabIds);
  const splitView = useChatStore((s) => s.splitView);
  const agents = useChatStore((s) => s.agents);
  // Conversation search lives in a command-palette overlay (Ctrl+S), not a
  // permanently visible bar — keeps the header clean.
  const [searchOpen, setSearchOpen] = useState(false);
  const currentUser = useChatStore((s) => s.currentUser);
  const setCurrentUser = useChatStore((s) => s.setCurrentUser);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const closeTab = useChatStore((s) => s.closeTab);
  const setSplitView = useChatStore((s) => s.setSplitView);
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string; avatar?: string; createdAt: string }[]>([]);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [personaModal, setPersonaModal] = useState<{ open: boolean; editing: Persona | null }>({ open: false, editing: null });

  // Split view shows the active tab plus the tab after it (wrapping), both
  // joined to the socket so they stream independently.
  const idx = currentConversationId ? openTabIds.indexOf(currentConversationId) : -1;
  const otherId = splitView && idx >= 0 && openTabIds.length >= 2 ? openTabIds[(idx + 1) % openTabIds.length] : null;
  const visibleIds =
    currentConversationId === null
      ? []
      : splitView && otherId
        ? [currentConversationId, otherId]
        : [currentConversationId];

  const [conversationError, setConversationError] = useState<string | null>(null);

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

  // Ctrl+S opens/toggles the conversation search palette (search has no
  // always-visible bar anymore). Browser save dialog is suppressed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Profile chip — left anchor (brand title removed) */}
          <button
            onClick={async () => {
              const availableUsers = await listUsers();
              setUsers(availableUsers);
              setCurrentUser(null);
            }}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Switch profile"
          >
            <span className="text-base">{currentUser?.avatar || '🙂'}</span>
            <span className="hidden sm:block text-xs font-medium text-gray-600 dark:text-gray-300">
              {currentUser?.name || 'Guest'}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Connection status */}
          <div className="flex items-center gap-1.5 mr-1">
            <span className={cn('w-2 h-2 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')} />
            <span className="hidden sm:block text-xs text-gray-500 dark:text-gray-400">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            title="Search conversations (Ctrl+S)"
            aria-label="Search conversations"
          >
            <Search className="w-5 h-5" />
          </button>

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
              <div className="overflow-y-auto p-2 space-y-1 max-h-[calc(100vh-120px)]">
                {conversations.map((conv) => (
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

        {/* Conversation search palette — only via Ctrl+S or the header icon */}
        <SearchPalette
          key={searchOpen ? 'open' : 'closed'}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
          currentConversationId={currentConversationId}
          onSelect={setCurrentConversation}
        />

        {/* Main chat area */}
        <main className="flex-1 min-w-0 flex flex-col p-2 md:p-3">
          {/* Chat panel — one coherent light surface filling the window (only
              the messages/composer content is centered to a reading column) */}
          <div className="w-full flex-1 flex flex-col bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">

            {/* Tab strip — every open conversation, active highlighted, + for
                new, split toggle on the right */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 pt-1.5 flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {openTabIds.map((id) => {
                const active = id === currentConversationId;
                const conv = conversations.find((c) => c.id === id);
                return (
                  <div
                    key={id}
                    className={cn(
                      'group flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-t-lg text-xs font-medium whitespace-nowrap shrink-0 border border-b-0 transition-colors',
                      active
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                        : 'text-gray-500 dark:text-gray-400 border-transparent hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <button
                      onClick={() => setCurrentConversation(id)}
                      className="max-w-[140px] truncate"
                      title={conv?.title || 'Conversation'}
                    >
                      {conv?.title || 'New chat'}
                    </button>
                    <button
                      onClick={() => closeTab(id)}
                      className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                      title={`Close ${conv?.title || 'tab'}`}
                      aria-label={`Close tab ${conv?.title || ''}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}

              <button
                onClick={() => { void handleNewConversation(); }}
                className="p-1.5 rounded-md text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 shrink-0"
                title="New conversation"
                aria-label="New conversation"
              >
                <Plus className="w-4 h-4" />
              </button>

              {openTabIds.length >= 2 && (
                <button
                  onClick={() => setSplitView(!splitView)}
                  className={cn(
                    'ml-auto p-1.5 rounded-md shrink-0',
                    splitView
                      ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
                      : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                  )}
                  title={splitView ? 'Exit split view' : 'Split view — two conversations side by side'}
                  aria-label="Toggle split view"
                >
                  <Columns2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Persona bar — always visible above chat */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
                <span className="flex items-center gap-2 whitespace-nowrap mr-1 shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    Personas
                  </span>
                  {agents.length > 0 && (
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                        agents.some((a) => a.enabled)
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
                      )}
                    >
                      {agents.filter((a) => a.enabled).length} active
                    </span>
                  )}
                </span>
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    title={agent.enabled ? `Disable ${agent.name}` : `Enable ${agent.name}`}
                    className={cn(
                      'group flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-all',
                      agent.enabled
                        ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600'
                    )}
                  >
                    {/* Avatar with presence-style status dot */}
                    <span className="relative inline-flex shrink-0">
                      <span
                        className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-sm',
                          agent.enabled
                            ? 'bg-white dark:bg-gray-800'
                            : 'bg-gray-200 dark:bg-gray-600 grayscale opacity-70'
                        )}
                      >
                        {agent.avatar || agent.name[0]}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-gray-800',
                          agent.enabled ? 'bg-green-500' : 'bg-gray-400'
                        )}
                      />
                    </span>
                    <span className="max-w-[80px] truncate">{agent.name}</span>
                    {/* Edit — hover-revealed affordance inside the pill (plain
                        span: keeps the pill the single accessible button) */}
                    <span
                      aria-hidden="true"
                      onClick={(e) => { e.stopPropagation(); setPersonaModal({ open: true, editing: agent }); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-500"
                    >
                      <Pencil className="w-3 h-3" />
                    </span>
                  </button>
                ))}
                {agents.length === 0 ? (
                  <button
                    onClick={() => setPersonaModal({ open: true, editing: null })}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:text-blue-500 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create your first persona
                  </button>
                ) : (
                  <button
                    onClick={() => setPersonaModal({ open: true, editing: null })}
                    title="New persona"
                    aria-label="New persona"
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-blue-500 border border-dashed border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Panes — one, or two side-by-side in split view */}
            {currentConversationId === null ? (
              <div className="flex-1 flex items-center justify-center text-center text-gray-500 dark:text-gray-400">
                <div>
                  <MessageSquare className="w-16 h-16 mb-4 opacity-50 mx-auto" />
                  <h3 className="text-lg font-medium">No conversation selected</h3>
                  <p className="text-sm">Create or select a conversation to start chatting</p>
                  <button onClick={() => { void handleNewConversation(); }} className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg">
                    <Plus className="w-4 h-4 mr-2" /> New Conversation
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex">
                {visibleIds.map((id, i) => (
                  <div
                    key={id}
                    className={cn(
                      'flex-1 min-w-0 flex flex-col',
                      i > 0 && 'border-l border-gray-200 dark:border-gray-700'
                    )}
                  >
                    <ConversationPane
                      conversation={conversations.find((c) => c.id === id)}
                      userAvatar={currentUser?.avatar}
                      connected={connected}
                      showClose={visibleIds.length > 1}
                      onCloseTab={closeTab}
                      onSend={sendMessage}
                      onStop={stopGeneration}
                      onDeleteMessage={deleteMessage}
                      onRegenerate={regenerateMessage}
                      loadOlderMessages={loadOlderMessages}
                      onJoin={joinConversation}
                      onLeave={leaveConversation}
                    />
                  </div>
                ))}
              </div>
            )}

            {conversationError && (
              <div className="shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-1.5 flex justify-center">
                <span className="text-xs text-red-500 dark:text-red-400">{conversationError}</span>
              </div>
            )}
          </div>{/* /chat panel card */}
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