import { useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { ClipboardPaste, Copy, Scissors, ListChecks, Send, Square } from 'lucide-react';
import { cn } from '../lib/utils';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { readClipboardText, replaceSelection, writeClipboardText } from '../lib/clipboard';

/** Must match the backend limit in handler.ts (Bug #30). */
export const MAX_MESSAGE_LENGTH = 100_000;

/** Show a warning when the message exceeds this percentage of the limit. */
const WARN_THRESHOLD = 0.8;

interface InputBarProps {
  /** Returns false when the message could not be handed to the transport. */
  onSend: (content: string) => boolean;
  disabled?: boolean;
  /** True while at least one agent is streaming a reply in this conversation. */
  streaming?: boolean;
  /** Abort the active generation. When set, the stop button replaces send. */
  onStop?: () => void;
}

interface ContextPosition {
  x: number;
  y: number;
}

interface SelectionRange {
  start: number;
  end: number;
}

export function InputBar({ onSend, disabled, streaming = false, onStop }: InputBarProps) {
  const [content, setContent] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextPosition | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectionRange>({ start: 0, end: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<SelectionRange>({ start: 0, end: 0 });
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const length = content.length;
  const isOverLimit = length > MAX_MESSAGE_LENGTH;
  const isNearLimit = length > MAX_MESSAGE_LENGTH * WARN_THRESHOLD && !isOverLimit;
  const canSend = content.trim().length > 0 && !disabled && !isOverLimit;

  const showClipboardNotice = (notice: string) => {
    setClipboardNotice(notice);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setClipboardNotice(null), 2500);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    if (onSend(content.trim())) {
      setContent('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const captureSelection = (target: HTMLTextAreaElement): SelectionRange => ({
    start: target.selectionStart ?? content.length,
    end: target.selectionEnd ?? content.length,
  });

  const focusSelection = (selection: SelectionRange) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selection.start, selection.end);
    });
  };

  const openContextMenu = (e: MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const selection = captureSelection(e.currentTarget);
    selectionRef.current = selection;
    setSelectedRange(selection);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const getSelectedText = () => {
    const { start, end } = selectionRef.current;
    return content.slice(Math.min(start, end), Math.max(start, end));
  };

  const copySelection = async () => {
    const selected = getSelectedText();
    if (!selected) {
      showClipboardNotice('Select text first to copy it.');
      focusSelection(selectionRef.current);
      return;
    }
    if (!(await writeClipboardText(selected))) {
      showClipboardNotice('Clipboard access is unavailable.');
      return;
    }
    focusSelection(selectionRef.current);
  };

  const cutSelection = async () => {
    const selected = getSelectedText();
    if (!selected) {
      showClipboardNotice('Select text first to cut it.');
      focusSelection(selectionRef.current);
      return;
    }
    if (!(await writeClipboardText(selected))) {
      showClipboardNotice('Clipboard access is unavailable.');
      return;
    }
    const next = replaceSelection(content, selectionRef.current.start, selectionRef.current.end, '');
    const collapsed = { start: next.cursor, end: next.cursor };
    setContent(next.value);
    selectionRef.current = collapsed;
    setSelectedRange(collapsed);
    focusSelection(collapsed);
  };

  const pasteClipboard = async () => {
    const pasted = await readClipboardText();
    if (pasted === null) {
      showClipboardNotice('Clipboard access is unavailable.');
      focusSelection(selectionRef.current);
      return;
    }
    const next = replaceSelection(content, selectionRef.current.start, selectionRef.current.end, pasted);
    const collapsed = { start: next.cursor, end: next.cursor };
    setContent(next.value);
    selectionRef.current = collapsed;
    setSelectedRange(collapsed);
    focusSelection(collapsed);
  };

  const selectAll = () => {
    const selection = { start: 0, end: content.length };
    selectionRef.current = selection;
    setSelectedRange(selection);
    focusSelection(selection);
  };

  const selectedText = content.slice(
    Math.min(selectedRange.start, selectedRange.end),
    Math.max(selectedRange.start, selectedRange.end),
  );
  const contextItems: ContextMenuItem[] = [
    {
      id: 'copy-selection',
      label: 'Copy',
      icon: Copy,
      disabled: !selectedText,
      onSelect: () => { void copySelection(); },
    },
    {
      id: 'cut-selection',
      label: 'Cut',
      icon: Scissors,
      disabled: !selectedText || disabled,
      onSelect: () => { void cutSelection(); },
    },
    {
      id: 'paste',
      label: 'Paste',
      icon: ClipboardPaste,
      disabled: disabled,
      separatorBefore: true,
      onSelect: () => { void pasteClipboard(); },
    },
    {
      id: 'select-all',
      label: 'Select all',
      icon: ListChecks,
      disabled: !content,
      separatorBefore: true,
      onSelect: selectAll,
    },
  ];

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-end gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onContextMenu={openContextMenu}
            disabled={disabled}
            placeholder="Type a message... (Shift+Enter for new line)"
            className={cn(
              'w-full min-h-[38px] max-h-[160px] px-3.5 py-2 text-sm',
              'bg-gray-50 dark:bg-gray-700 border rounded-xl',
              'text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'resize-none',
              isOverLimit
                ? 'border-red-400 dark:border-red-500'
                : isNearLimit
                ? 'border-amber-400 dark:border-amber-500'
                : 'border-gray-200 dark:border-gray-600'
            )}
            rows={1}
            style={{ overflowY: 'auto' }}
          />
        </div>

        {/* Action cluster: stop sits IN FRONT of send (streaming swaps send for stop) */}
        <div className="flex items-center gap-2 pb-0.5 shrink-0">
          {streaming && onStop ? (
            <>
              {/* Stop — directly in front of where send sits */}
              <button
                type="button"
                onClick={onStop}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
                aria-label="Stop generating"
                title="Stop generating"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
              {/* Send stays visible but inert while streaming */}
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-500"
                aria-hidden="true"
              >
                <Send className="w-4 h-4" />
              </span>
            </>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center transition-colors shadow-sm',
                canSend
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-500 cursor-not-allowed'
              )}
              aria-label="Send message"
              title="Send (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Character count — only visible when approaching or over the limit */}
      {(isNearLimit || isOverLimit) && (
        <div className="px-4 pb-1 flex items-center justify-between">
          <span className={cn(
            'text-xs',
            isOverLimit
              ? 'text-red-500 dark:text-red-400 font-medium'
              : 'text-amber-500 dark:text-amber-400'
          )}>
            {isOverLimit
              ? `Message too long (${length.toLocaleString()} / ${MAX_MESSAGE_LENGTH.toLocaleString()} characters)`
              : `${length.toLocaleString()} / ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`
            }
          </span>
        </div>
      )}

      {clipboardNotice && (
        <div className="px-4 pb-1" role="status" aria-live="polite">
          <span className="text-xs text-amber-600 dark:text-amber-400">{clipboardNotice}</span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </form>
  );
}
