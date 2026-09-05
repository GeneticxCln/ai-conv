import { useState } from 'react';
import { Persona } from '@ai-conv/types';
import { CheckCircle, Circle, Plus, Pencil } from 'lucide-react';
import { cn } from '../lib/utils';
import { InstalledModel } from '../lib/modelPicker';
import { PersonaModal } from './PersonaModal';

interface PersonaSidebarProps {
  agents: Persona[];
  onToggle: (agentId: string) => void;
  onCreate: (data: Partial<Persona>) => void;
  onUpdate: (id: string, patch: Partial<Persona>) => void;
  onDelete: (id: string) => void;
  getModels: () => Promise<InstalledModel[]>;
  getGpuInfo: () => Promise<{ available: boolean; name?: string; totalMiB?: number; usedMiB?: number }>;
  pullModel: (modelName: string) => void;
}

export function PersonaSidebar({ agents, onToggle, onCreate, onUpdate, onDelete, getModels, getGpuInfo, pullModel }: PersonaSidebarProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Persona | null>(null);

  const enabledAgents = agents.filter((a) => a.enabled);
  const disabledAgents = agents.filter((a) => !a.enabled);

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (agent: Persona) => {
    setEditing(agent);
    setModalOpen(true);
  };

  return (
    <div className="w-72 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Personas</h2>
        <span className="text-xs text-gray-500">
          {enabledAgents.length} / {agents.length} active
        </span>
      </div>

      <button
        onClick={openNew}
        className="m-3 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg"
      >
        <Plus className="w-4 h-4" />
        New Persona
      </button>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 scrollbar-thin">
        {agents.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8 text-sm px-4">
            No personas yet.
            <br />
            Create your first one above.
          </div>
        ) : (
          <>
            {enabledAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onToggle={onToggle} onEdit={openEdit} />
            ))}
            {disabledAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onToggle={onToggle} onEdit={openEdit} />
            ))}
          </>
        )}
      </div>

      <PersonaModal
        key={modalOpen ? `open-${editing?.id || 'new'}` : 'closed'}
        open={modalOpen}
        editing={editing}
        getModels={getModels}
        getGpuInfo={getGpuInfo}
        pullModel={pullModel}
        onClose={() => setModalOpen(false)}
        onSave={(data) => {
          if (editing) onUpdate(editing.id, data);
          else onCreate(data);
        }}
        onDelete={onDelete}
      />
    </div>
  );
}

function AgentCard({
  agent,
  onToggle,
  onEdit,
}: {
  agent: Persona;
  onToggle: (id: string) => void;
  onEdit: (agent: Persona) => void;
}) {
  return (
    <div
      className={cn(
        'w-full p-3 rounded-lg transition-all group',
        agent.enabled
          ? 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800'
          : 'bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700'
      )}
    >
      <div className="flex items-start gap-3">
        <button onClick={() => onToggle(agent.id)} className="flex-shrink-0" title="Enable/disable">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center text-lg',
              agent.enabled ? 'bg-purple-100 dark:bg-purple-900' : 'bg-gray-100 dark:bg-gray-700 opacity-50'
            )}
          >
            {agent.avatar || agent.name[0]}
          </div>
        </button>

        <button onClick={() => onToggle(agent.id)} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <h3 className={cn('font-medium text-sm truncate', agent.enabled ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400')}>
              {agent.name}
            </h3>
            {agent.enabled && <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
            {!agent.enabled && <Circle className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />}
          </div>
          <p className={cn('text-xs mt-0.5 truncate', agent.enabled ? 'text-gray-500' : 'text-gray-400')}>
            {agent.description || 'No description'}
          </p>
        </button>

        <button
          onClick={() => onEdit(agent)}
          className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 opacity-0 group-hover:opacity-100"
          title="Edit persona"
        >
          <Pencil className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
