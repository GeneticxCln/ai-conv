import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConversationRef {
  id: string;
  title: string;
}

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationRef[];
  currentConversationId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Command-palette style conversation search.
 * Hidden by default — opens with Ctrl+S (wired in Chat.tsx), closes on
 * Escape or backdrop click. Arrow keys + Enter navigate without the mouse.
 */
export function SearchPalette({ open, onClose, conversations, currentConversationId, onSelect }: SearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations.slice(0, 12);
    return conversations.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 12);
  }, [conversations, query]);

  // Focus after paint when the palette mounts for an open session. Chat gives
  // this component an open/closed key so its query and active row reset
  // naturally without setting state inside an effect.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Escape closes regardless of where focus sits (e.g. user clicked the
  // backdrop first). Container-level handler covers arrows/Enter while the
  // input is focused.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep the highlighted row in view.
  useEffect(() => {
    const el = inputRef.current?.parentElement?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIdx]) {
      e.preventDefault();
      onSelect(results[activeIdx].id);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[70] flex items-start justify-center pt-[12vh]"
      onClick={onClose}
      data-testid="search-palette"
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[560px] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input row */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none"
            aria-label="Search conversations"
          />
          <button onClick={onClose} aria-label="Close search" className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">
              {query.trim() ? `No conversations match “${query.trim()}”.` : 'No conversations yet — create one to get started.'}
            </p>
          )}
          {results.map((conv, idx) => (
            <button
              key={conv.id}
              data-idx={idx}
              data-testid="search-result-row"
              onClick={() => {
                onSelect(conv.id);
                onClose();
              }}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left',
                idx === activeIdx
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-200'
              )}
            >
              <MessageSquare className={cn('w-4 h-4 shrink-0', idx === activeIdx ? 'text-blue-500' : 'text-gray-400')} />
              <span className="text-sm truncate">{conv.title || 'Conversation'}</span>
              {conv.id === currentConversationId && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400 shrink-0">current</span>
              )}
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-3 text-[10px] text-gray-400">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">Enter</kbd> open</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
          <span className="ml-auto"><kbd className="font-mono">Ctrl+S</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
