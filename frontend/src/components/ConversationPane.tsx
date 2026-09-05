import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../stores/useChatStore';
import { MessageBubble } from './MessageBubble';
import { InputBar } from './InputBar';
import { MessageSquare, X } from 'lucide-react';
import { Conversation } from '@ai-conv/types';

interface ConversationPaneProps {
  conversation: Conversation | undefined;
  userAvatar?: string;
  connected: boolean;
  /** Render a close (×) affordance in the pane header — used in split view. */
  showClose?: boolean;
  onCloseTab?: (id: string) => void;
  onSend: (conversationId: string, content: string, options?: { agentChat?: boolean; tempId?: string }) => boolean;
  onStop: (conversationId: string) => void;
  onDeleteMessage: (id: string) => void;
  onRegenerate: (id: string) => void;
  loadOlderMessages: (conversationId: string) => Promise<boolean>;
  /** Join/leave the conversation on this socket when the pane mounts/unmounts. */
  onJoin?: (id: string) => void;
  onLeave?: (id: string) => void;
}

export function ConversationPane({
  conversation,
  userAvatar,
  connected,
  showClose = false,
  onCloseTab,
  onSend,
  onStop,
  onDeleteMessage,
  onRegenerate,
  loadOlderMessages,
  onJoin,
  onLeave,
}: ConversationPaneProps) {
  const conversationId = conversation?.id ?? null;

  const messages = useChatStore((s) => (conversationId ? s.messages[conversationId] || [] : []));
  const awaitingFirstToken = useChatStore((s) =>
    conversationId ? Boolean(s.awaitingFirstToken[conversationId]) : false
  );
  const streamingMessages = useChatStore((s) => s.streamingMessages);

  // Streaming = any message in THIS conversation is still producing tokens.
  // (Per-pane, so split panes show their own stop buttons independently.)
  const messageIds = new Set(messages.map((m) => m.id));
  const isStreaming = Object.keys(streamingMessages).some((id) => messageIds.has(id));

  const [sendError, setSendError] = useState(false);

  // Join the socket conversation room when the pane mounts / its id changes.
  useEffect(() => {
    if (!conversationId) return;
    onJoin?.(conversationId);
    return () => {
      onLeave?.(conversationId);
      // Don't leave a stale "loading model" indicator behind.
      useChatStore.getState().setAwaitingFirstToken(conversationId, false);
    };
  }, [conversationId, onJoin, onLeave]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
  }, [messages]);

  // Load the next older page when the user scrolls to the top.
  const loadingOlderRef = useRef(false);
  const hasAllHistoryRef = useRef(false);
  const handleScroll = async () => {
    const el = scrollContainerRef.current;
    if (!el || !conversationId) return;
    if (el.scrollTop > 40 || loadingOlderRef.current || hasAllHistoryRef.current) return;
    loadingOlderRef.current = true;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    const gotMore = await loadOlderMessages(conversationId);
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
  }, [conversationId]);

  const handleSend = (content: string): boolean => {
    if (!conversationId) return false;
    const tempId = crypto.randomUUID();
    // Optimistically render user message immediately
    useChatStore.getState().addMessage(conversationId, {
      id: tempId,
      conversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      isStreaming: false,
    });
    const ok = onSend(conversationId, content, {
      agentChat: useChatStore.getState().agentChat,
      tempId,
    });
    setSendError(!ok);
    return ok;
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-gray-800">
      {/* Pane header */}
      {conversationId && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-medium text-gray-900 dark:text-gray-100 truncate">
              {conversation?.title || 'Conversation'}
            </h2>
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {messages.filter((m) => m.role === 'agent').length} responses
            </span>
          </div>
          {showClose && onCloseTab && conversationId && (
            <button
              onClick={() => onCloseTab(conversationId!)}
              className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300"
              title="Close tab"
              aria-label={`Close tab ${conversation?.title || ''}`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Messages — centered reading column */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
              <MessageSquare className="w-16 h-16 mb-4 opacity-50" />
              <h3 className="text-lg font-medium">No messages yet</h3>
              <p className="text-sm">Start the conversation!</p>
            </div>
          )}

          {messages.length > 0 && (
            <>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  userAvatar={userAvatar}
                  canRegenerate={i === messages.length - 1 && msg.role === 'agent' && !msg.isStreaming}
                  onDelete={onDeleteMessage}
                  onRegenerate={onRegenerate}
                />
              ))}
              <div ref={messagesEndRef} />
            </>
          )}

          {awaitingFirstToken && (
            <div className="px-4 pb-1 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span
                className="inline-block w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin"
                aria-hidden="true"
              />
              <span>Loading model… first response can take a while on larger models.</span>
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
      </div>

      {/* Composer — fixed at the bottom, same centered column as messages */}
      <div className="shrink-0 bg-white dark:bg-gray-800">
        <div className="max-w-3xl mx-auto">
          <InputBar
            onSend={handleSend}
            disabled={!conversationId || !connected}
            streaming={isStreaming}
            onStop={conversationId ? () => onStop(conversationId) : undefined}
          />
        </div>
      </div>
    </div>
  );
}