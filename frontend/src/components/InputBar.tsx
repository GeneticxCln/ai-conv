import { useState, FormEvent, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { cn } from '../lib/utils';

/** Must match the backend limit in handler.ts (Bug #30). */
export const MAX_MESSAGE_LENGTH = 100_000;

/** Show a warning when the message exceeds this percentage of the limit. */
const WARN_THRESHOLD = 0.8;

interface InputBarProps {
  /** Returns false when the message could not be handed to the transport. */
  onSend: (content: string) => boolean;
  disabled?: boolean;
}

export function InputBar({ onSend, disabled }: InputBarProps) {
  const [content, setContent] = useState('');

  const length = content.length;
  const isOverLimit = length > MAX_MESSAGE_LENGTH;
  const isNearLimit = length > MAX_MESSAGE_LENGTH * WARN_THRESHOLD && !isOverLimit;
  const canSend = content.trim().length > 0 && !disabled && !isOverLimit;

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

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-end gap-2 p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="flex-1 relative">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Type a message... (Shift+Enter for new line)"
            className={cn(
              'w-full min-h-[44px] max-h-[200px] px-4 py-3 pr-12 text-sm',
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
          <button
            type="submit"
            disabled={!canSend}
            className={cn(
              'absolute right-3 bottom-3 p-2 rounded-lg transition-colors',
              'hover:bg-gray-100 dark:hover:bg-gray-600',
              canSend
                ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-600'
                : 'text-gray-300 dark:text-gray-500 cursor-not-allowed'
            )}
            aria-label="Send message"
          >
            <Send className="w-5 h-5" />
          </button>
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
    </form>
  );
}
