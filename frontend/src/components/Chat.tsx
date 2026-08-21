import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { MessageBubble } from './MessageBubble';
import { InputBar } from './InputBar';
import { PersonaSidebar } from './PersonaSidebar';
import { SettingsModal } from './SettingsModal';
import { LoginModal } from './LoginModal';
import { MessageSquare, Plus, Settings, X, Download, Upload, Users, Menu, User as UserIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSocket } from '../hooks/useSocket';

export function Chat() {
  const connected = useChatStore((s) => s.connected);
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const currentMessages = useChatStore((s) =>
    s.currentConversationId ? s.messages[s.currentConversationId] || [] : []
  );
  const agents = useChatStore((s) => s.agents);
  const currentUser = useChatStore((s) => s.currentUser);
  const setCurrentUser = useChatStore((s) => s.setCurrentUser);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const toggleAgent = useChatStore((s) => s.toggleAgent);

  const {
    sendMessage,
    stopGeneration,
    joinConversation,
    leaveConversation,
    createPersona,
    updatePersona,
    deletePersona,
    createConversation,
    deleteConversation,
    renameConversation,
    clearConversations,
    getModels: getModelsFn,
    pullModel,
    listUsers,
    createUser,
    deleteExistingUser,
    setParticipants,
    deleteMessage,
    regenerateMessage,
    importConversation,
  } = useSocket();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; name: string; avatar?: string }[]>([]);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);
  const streamingCount = useChatStore((s) => Object.keys(s.streamingMessages).length);
  const currentConv = conversations.find((c) => c.id === currentConversationId);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Autoscroll only while the user is already near the bottom; never yank the
  // viewport while they are reading history mid-stream.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 160) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentMessages]);

  useEffect(() => {
    if (currentConversationId) {
      joinConversation(currentConversationId);
    }
    return () => {
      if (currentConversationId) {
        leaveConversation(currentConversationId);
      }
    };
  }, [currentConversationId, joinConversation, leaveConversation]);

  const [sendError, setSendError] = useState(false);

  const handleSend = (content: string): boolean => {
    if (!currentConversationId) return false;
    const ok = sendMessage(currentConversationId, content, { agentChat: useChatStore.getState().agentChat });
    setSendError(!ok);
    return ok;
  };

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const commitRename = () => {
    const t = renameDraft.trim();
    if (renamingId && t) renameConversation(renamingId, t);
    setRenamingId(null);
  };


  const handleNewConversation = () => createConversation();

  const handleExport = () => {
    if (!currentConversationId || currentMessages.length === 0) return;
    const conv = conversations.find((c) => c.id === currentConversationId);
    const lines = [`# ${conv?.title || 'Conversation'}`, ''];
    for (const m of currentMessages) {
      const who = m.role === 'user' ? 'You' : m.agentName || 'Agent';
      lines.push(`**${who}** (${new Date(m.createdAt).toLocaleString()}):`, '', m.content, '', '---', '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(conv?.title || 'conversation').replace(/[^\w-]+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const conv = await importConversation({
        title: String(data.title || 'Imported'),
        messages: Array.isArray(data.messages) ? data.messages : [],
      });
      if (conv) setCurrentConversation(conv.id);
    } catch {
      alert('Invalid conversation file');
    }
  };

  const toggleParticipant = (personaId: string) => {
    if (!currentConversationId || !currentConv) return;
    const cur = currentConv.participants || [];
    const next = cur.includes(personaId) ? cur.filter((p) => p !== personaId) : [...cur, personaId];
    setParticipants(currentConversationId, next);
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
            onClick={() => { listUsers().then(setUsers); setCurrentUser(null); }}
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

          {/* Mobile drawers */}
          <button
            onClick={() => setLeftDrawer(true)}
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            aria-label="Conversations"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={() => setRightDrawer(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            aria-label="Personas"
          >
            <UserIcon className="w-5 h-5" />
          </button>

          <button
            onClick={handleNewConversation}
            disabled={!connected}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-40"
            aria-label="New conversation"
          >
            <Plus className="w-5 h-5" />
          </button>

          <button
            onClick={handleExport}
            disabled={!currentConversationId || currentMessages.length === 0}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-40"
            aria-label="Export conversation"
            title="Export as Markdown"
          >
            <Download className="w-5 h-5" />
          </button>

          <label
            className={cn(
              'p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer',
              !connected && 'opacity-40 pointer-events-none'
            )}
            title="Import conversation (.json)"
          >
            <Upload className="w-5 h-5" />
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.currentTarget.value = '';
              }}
            />
          </label>

          {/* Participants picker */}
          <div className="relative">
            <button
              onClick={() => setParticipantsOpen((v) => !v)}
              disabled={!currentConversationId}
              className={cn(
                'p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-40',
                participantsOpen && 'bg-gray-100 dark:bg-gray-700'
              )}
              aria-label="Who replies in this chat"
              title="Who replies in this chat"
            >
              <Users className="w-5 h-5" />
            </button>
            {participantsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setParticipantsOpen(false)} />
                <div className="absolute right-0 top-11 z-50 w-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1">
                    Personas replying here
                  </p>
                  {agents.length === 0 && (
                    <p className="text-xs text-gray-400 px-2 py-2">No personas yet</p>
                  )}
                  {agents.map((a) => {
                    const checked = !currentConv?.participants || currentConv.participants.length === 0 || currentConv.participants.includes(a.id);
                    return (
                      <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleParticipant(a.id)}
                          className="accent-blue-600"
                        />
                        <span>{a.avatar || '🤖'}</span>
                        <span className="truncate">{a.name}</span>
                      </label>
                    );
                  })}
                  <p className="text-[10px] text-gray-400 px-2 pt-1">Unchecked personas stay silent in this chat</p>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversations */}
        <aside className="hidden md:flex w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-medium text-gray-900 dark:text-gray-100">Conversations</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
            {conversations.length === 0 ? (
              <div className="text-center text-gray-500 dark:text-gray-400 py-8 text-sm">No conversations yet</div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    'group relative rounded-lg cursor-pointer transition-colors',
                    currentConversationId === conv.id
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  )}
                  onClick={() => setCurrentConversation(conv.id)}
                  onDoubleClick={() => { setRenamingId(conv.id); setRenameDraft(conv.title); }}
                >
                  {renamingId === conv.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full px-1.5 py-0.5 text-sm font-medium bg-white dark:bg-gray-700 border border-blue-400 rounded text-gray-900 dark:text-gray-100 focus:outline-none"
                    />
                  ) : (
                    <p
                      className={cn(
                        'font-medium text-sm truncate',
                        currentConversationId === conv.id
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-200'
                      )}
                    >
                      {conv.title}
                    </p>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    aria-label="Delete conversation"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleNewConversation}
              disabled={!connected}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              New Conversation
            </button>
          </div>
        </aside>

        {/* Chat area */}
        <main className="flex-1 flex flex-col min-w-0">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
            {currentMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
                <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-lg">Start chatting</p>
                <p className="text-sm">Enabled personas will reply. Use @Name to target one.</p>
              </div>
            ) : (
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
          </div>

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
          {sendError && (
            <div className="px-4 pb-1 flex justify-center">
              <span className="text-xs text-red-500 dark:text-red-400">
                Message not sent — connection lost. Your draft is preserved.
              </span>
            </div>
          )}

          <InputBar onSend={handleSend} disabled={!currentConversationId || !connected} />
        </main>

        {/* Personas */}
        <aside className="hidden lg:block">
          <PersonaSidebar
            agents={agents}
            onToggle={toggleAgent}
            onCreate={createPersona}
            onUpdate={updatePersona}
            onDelete={deletePersona}
            getModels={getModelsFn}
          />
        </aside>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onClearConversations={clearConversations}
        getModels={getModelsFn}
        pullModel={pullModel}
      />

      <LoginModal
        key={currentUser ? 'picked' : 'open'}
        open={!currentUser}
        users={users}
        onPick={setCurrentUser}
        onCreate={createUser}
        onDeleteUser={(id) => {
          deleteExistingUser(id);
          if (currentUser?.id === id) setCurrentUser(null);
          listUsers().then(setUsers);
        }}
      />

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
              <button onClick={() => { createConversation(); setLeftDrawer(false); }} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg">
                <Plus className="w-4 h-4" /> New Conversation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile right drawer (personas) */}
      {rightDrawer && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setRightDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute right-0 top-0 bottom-0 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <PersonaSidebar
              agents={agents}
              onToggle={toggleAgent}
              onCreate={createPersona}
              onUpdate={updatePersona}
              onDelete={deletePersona}
              getModels={getModelsFn}
            />
          </div>
        </div>
      )}
    </div>
  );
}
