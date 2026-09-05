import { useState } from 'react';
import { User as UserIcon, Plus, Trash2 } from 'lucide-react';
import { User } from '@ai-conv/types';
import { getLastAuthError, clearLastAuthError } from '../hooks/useSocketActions';

interface LoginModalProps {
  open: boolean;
  users: User[];
  onPick: (u: User) => void | Promise<void>;
  onCreate: (name: string, avatar?: string) => Promise<User | null>;
  onDeleteUser: (id: string) => void;
  onClose?: () => void;
}

const AVATARS = ['🙂', '😎', '🦊', '🐼', '🚀', '🌟', '🎧', '🐙'];

export function LoginModal({ open, users, onPick, onCreate, onDeleteUser, onClose }: LoginModalProps) {
  // When there are no users, always create; otherwise user can toggle into create mode
  const [isCreating, setIsCreating] = useState(false);
  const mode = users.length === 0 || isCreating ? 'create' : 'pick';

  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('🙂');
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Show WHY the last profile action failed (e.g. stale token rejected).
  const run = async (fn: () => Promise<User | null>) => {
    setBusy(true);
    setError(null);
    clearLastAuthError();
    const u = await fn();
    setBusy(false);
    if (!u) {
      setError(getLastAuthError() || 'That did not work — please try again');
    }
    return u;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[380px] p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserIcon className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'pick' ? 'Who is chatting?' : 'Create profile'}
          </h2>
        </div>

        {mode === 'pick' ? (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setError(null);
                    clearLastAuthError();
                    await onPick(u);
                    const err = getLastAuthError();
                    if (err) setError(err);
                  }}
                  className="flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-left"
                >
                  <span className="text-xl">{u.avatar || '🙂'}</span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{u.name}</span>
                </button>
                {confirmDeleteId === u.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { onDeleteUser(u.id); setConfirmDeleteId(null); }}
                      className="text-xs font-medium text-red-500 hover:text-red-600 px-1.5 py-1"
                      aria-label="Confirm delete profile"
                    >
                      Delete?
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1"
                      aria-label="Cancel delete profile"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(u.id)}
                    className="p-2 text-gray-300 hover:text-red-500"
                    title="Delete profile"
                    aria-label="Delete profile"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setIsCreating(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600"
            >
              <Plus className="w-4 h-4" /> New profile
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex flex-wrap gap-1.5">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatar(a)}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center ${
                    avatar === a ? 'bg-blue-100 ring-2 ring-blue-500' : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              {users.length > 0 && (
                <button onClick={() => setIsCreating(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                  Back
                </button>
              )}
              <button
                disabled={!name.trim() || busy}
                onClick={async () => {
                  const u = await run(() => onCreate(name.trim(), avatar));
                  if (u) onClose?.();
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {busy ? 'Working…' : 'Start chatting'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1.5" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}