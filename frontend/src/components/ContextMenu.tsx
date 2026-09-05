import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { cn } from '../lib/utils';

type MenuIcon = ComponentType<{ className?: string }>;

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: MenuIcon;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 224;
const VIEWPORT_GUTTER = 8;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const firstEnabled = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    firstEnabled?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [],
      );
      if (buttons.length === 0) return;
      event.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + direction + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const left = typeof window === 'undefined'
    ? x
    : Math.min(
        Math.max(VIEWPORT_GUTTER, x),
        Math.max(VIEWPORT_GUTTER, window.innerWidth - MENU_WIDTH - VIEWPORT_GUTTER),
      );
  const top = typeof window === 'undefined'
    ? y
    : Math.min(Math.max(VIEWPORT_GUTTER, y), Math.max(VIEWPORT_GUTTER, window.innerHeight - 360));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      style={{ left, top }}
      className="fixed z-[100] min-w-[14rem] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-800"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.id}>
            {item.separatorBefore && <div role="separator" className="my-1 border-t border-gray-100 dark:border-gray-700" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                onClose();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                'text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none',
                'dark:text-gray-200 dark:hover:bg-gray-700 dark:focus:bg-gray-700',
                'disabled:cursor-not-allowed disabled:opacity-40',
                item.destructive && 'text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 dark:focus:bg-red-900/20',
              )}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
