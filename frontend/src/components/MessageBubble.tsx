import { isValidElement, memo, useState, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Trash2, RefreshCw } from 'lucide-react';
import { Message } from '@ai-conv/types';
import { cn } from '../lib/utils';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import { writeClipboardText } from '../lib/clipboard';

interface MessageBubbleProps {
  message: Message;
  /** Logged-in profile's emoji — shown on the user's own messages. */
  userAvatar?: string;
  canRegenerate?: boolean;
  onDelete?: (id: string) => void;
  onRegenerate?: (id: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  type: 'message' | 'code';
  code?: string;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return '';
}

function classNameFromNode(node: ReactNode): string | undefined {
  if (isValidElement<{ className?: unknown; children?: ReactNode }>(node)) {
    if (typeof node.props.className === 'string') return node.props.className;
    return classNameFromNode(node.props.children);
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const className = classNameFromNode(child);
      if (className) return className;
    }
  }
  return undefined;
}

function languageFromClassName(className: unknown): string {
  if (typeof className !== 'string') return 'Code';
  const match = /(?:^|\\s)(?:language|lang)-([^\\s]+)/.exec(className);
  if (!match) return 'Code';
  const language = match[1].toLowerCase();
  const labels: Record<string, string> = {
    bash: 'Shell',
    c: 'C',
    cpp: 'C++',
    cs: 'C#',
    css: 'CSS',
    go: 'Go',
    html: 'HTML',
    java: 'Java',
    javascript: 'JavaScript',
    j: 'JavaScript',
    js: 'JavaScript',
    json: 'JSON',
    jsx: 'JSX',
    markdown: 'Markdown',
    md: 'Markdown',
    php: 'PHP',
    py: 'Python',
    python: 'Python',
    rust: 'Rust',
    sh: 'Shell',
    sql: 'SQL',
    swift: 'Swift',
    ts: 'TypeScript',
    tsx: 'TSX',
    typescript: 'TypeScript',
    yaml: 'YAML',
    yml: 'YAML',
  };
  return labels[language] || language.charAt(0).toUpperCase() + language.slice(1);
}

export const MessageBubble = memo(function MessageBubble({ message, userAvatar, canRegenerate, onDelete, onRegenerate }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const isUser = message.role === 'user';

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const copyText = async (text: string) => {
    const copiedSuccessfully = await writeClipboardText(text);
    if (!copiedSuccessfully) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copy = () => copyText(message.content);

  const openMessageContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, type: 'message' });
  };

  const openCodeContextMenu = (event: MouseEvent<HTMLElement>, code: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, type: 'code', code });
  };

  const messageContextItems: ContextMenuItem[] = [
    {
      id: 'copy-message',
      label: copied ? 'Copied' : 'Copy message',
      disabled: !message.content,
      onSelect: () => { void copy(); },
    },
  ];

  if (!isUser && canRegenerate && onRegenerate && message.content) {
    messageContextItems.push({
      id: 'regenerate-message',
      label: 'Regenerate response',
      separatorBefore: true,
      onSelect: () => onRegenerate(message.id),
    });
  }
  if (onDelete) {
    messageContextItems.push({
      id: 'delete-message',
      label: 'Delete message',
      destructive: true,
      separatorBefore: !isUser && Boolean(canRegenerate && onRegenerate && message.content),
      onSelect: () => onDelete(message.id),
    });
  }

  const codeToCopy = contextMenu?.type === 'code' ? contextMenu.code : undefined;
  const contextItems: ContextMenuItem[] = contextMenu?.type === 'code'
    ? [{
        id: 'copy-code',
        label: copied ? 'Copied' : 'Copy code',
        disabled: !codeToCopy,
        onSelect: () => { if (codeToCopy) void copyText(codeToCopy); },
      }]
    : messageContextItems;

  if (message.role === 'system') {
    return (
      <>
        <div
          className="flex justify-center my-2"
          onContextMenu={openMessageContextMenu}
        >
          <span className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full">
            {message.content}
          </span>
        </div>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextItems}
            onClose={() => setContextMenu(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className={cn('flex gap-3 max-w-[85%] group animate-fade-in', isUser && 'flex-row-reverse ml-auto')}
        onContextMenu={openMessageContextMenu}
      >
        <div
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium',
            isUser ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
          )}
        >
          {isUser ? userAvatar || 'U' : message.agentName?.[0] || 'A'}
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
                  type="button"
                  onClick={() => { void copy(); }}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100"
                  title="Copy"
                  aria-label="Copy message"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {!isUser && canRegenerate && onRegenerate && (
                  <button
                    type="button"
                    onClick={() => onRegenerate(message.id)}
                    className="p-0.5 rounded text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100"
                    title="Regenerate"
                    aria-label="Regenerate response"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(message.id)}
                    className="p-0.5 rounded text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                    title="Delete"
                    aria-label="Delete message"
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
                <div className="markdown-body break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:my-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1.5 [&_a]:text-blue-500 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 dark:[&_blockquote]:border-gray-600 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:bg-gray-100 dark:[&_code]:bg-gray-700 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-gray-300 dark:[&_th]:border-gray-600 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-gray-300 dark:[&_td]:border-gray-600 [&_td]:px-2 [&_td]:py-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre({ children, node: _node, ...props }) {
                        const code = textFromNode(children).replace(/\n$/, '');
                        const language = languageFromClassName(classNameFromNode(children));
                        return (
                          <div
                            className="group/code my-3 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-sm dark:border-gray-700 dark:bg-gray-950"
                            data-testid="markdown-code-block"
                            data-language={language}
                            onContextMenu={(event) => openCodeContextMenu(event, code)}
                          >
                            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100/80 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900/80">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                {language}
                              </span>
                              <span className="text-[10px] text-gray-400 opacity-0 transition-opacity group-hover/code:opacity-100">
                                Right-click to copy
                              </span>
                            </div>
                            <pre
                              {...props}
                              className="!m-0 !rounded-none !bg-transparent !p-4 text-[13px] leading-6 text-gray-800 dark:text-gray-200"
                              onContextMenu={(event) => openCodeContextMenu(event, code)}
                            >
                              {children}
                            </pre>
                          </div>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              )
            ) : (
              <span className="text-gray-400">…</span>
            )}
          </div>
        </div>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
});
