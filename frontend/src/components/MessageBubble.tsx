import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Trash2, RefreshCw } from 'lucide-react';
import { Message } from '../types';
import { cn } from '../lib/utils';

interface MessageBubbleProps {
  message: Message;
  canRegenerate?: boolean;
  onDelete?: (id: string) => void;
  onRegenerate?: (id: string) => void;
}

export const MessageBubble = memo(function MessageBubble({ message, canRegenerate, onDelete, onRegenerate }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  const copy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn('flex gap-3 max-w-[85%] group animate-fade-in', isUser && 'flex-row-reverse ml-auto')}>
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium',
          isUser ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
        )}
      >
        {isUser ? 'U' : message.agentName?.[0] || 'A'}
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <div className={cn('flex items-center gap-2 text-xs', isUser && 'flex-row-reverse')}>
          {!isUser && <span className="font-medium text-purple-700 dark:text-purple-300">{message.agentName}</span>}
          <span className="text-gray-400">{formatTime(message.createdAt)}</span>
          {message.isStreaming && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" />
              <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            </span>
          )}
          {!message.isStreaming && message.content && (
            <>
              <button
                onClick={copy}
                className="p-0.5 rounded text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100"
                title="Copy"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              {!isUser && canRegenerate && onRegenerate && (
                <button
                  onClick={() => onRegenerate(message.id)}
                  className="p-0.5 rounded text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100"
                  title="Regenerate"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => onDelete(message.id)}
                  className="p-0.5 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        <div
          className={cn(
            'px-4 py-2.5 rounded-2xl text-sm overflow-hidden',
            isUser
              ? 'bg-blue-600 text-white rounded-tr-none'
              : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-none shadow-sm border border-gray-100 dark:border-gray-700'
          )}
        >
          {message.content ? (
            isUser ? (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              <div className="markdown-body break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:my-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1.5 [&_a]:text-blue-500 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 dark:[&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:bg-gray-100 dark:[&_code]:bg-gray-700 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-gray-300 dark:[&_th]:border-gray-600 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-gray-300 dark:[&_td]:border-gray-600 [&_td]:px-2 [&_td]:py-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
            )
          ) : (
            <span className="text-gray-400">…</span>
          )}
        </div>
      </div>
    </div>
  );
});