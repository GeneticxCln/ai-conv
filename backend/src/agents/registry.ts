import { BaseAgent } from './base.js';
import { Persona } from '@ai-conv/types';
import { Server } from 'socket.io';
import { updatePersonaRow } from '../storage/db.js';

type OwnedPersona = Persona & { userId?: string };

export class AgentRegistry {
  private agents = new Map<string, BaseAgent>();
  private personas = new Map<string, OwnedPersona>();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  register(persona: OwnedPersona, agentClass: new (persona: Persona, io: Server) => BaseAgent): void {
    this.personas.set(persona.id, persona);
    this.agents.set(persona.id, new agentClass(persona, this.io));
  }

  unregister(id: string): boolean {
    const removedAgent = this.agents.delete(id);
    const removedPersona = this.personas.delete(id);
    return removedAgent || removedPersona;
  }

  get(id: string, userId?: string): BaseAgent | undefined {
    const persona = this.personas.get(id);
    if (userId && persona?.userId !== userId) return undefined;
    return this.agents.get(id);
  }

  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getEnabled(userId?: string): BaseAgent[] {
    return this.getAll().filter((agent) => {
      if (!agent.enabled) return false;
      if (!userId) return true;
      return this.personas.get(agent.id)?.userId === userId;
    });
  }

  getPersona(id: string, userId?: string): OwnedPersona | undefined {
    const persona = this.personas.get(id);
    if (userId && persona?.userId !== userId) return undefined;
    return persona;
  }

  getAllPersonas(userId?: string): OwnedPersona[] {
    return Array.from(this.personas.values()).filter((persona) => !userId || persona.userId === userId);
  }

  toggleAgent(id: string, userId: string): boolean | undefined {
    const persona = this.personas.get(id);
    if (!persona || persona.userId !== userId) return undefined;
    persona.enabled = !persona.enabled;
    updatePersonaRow(id, userId, { enabled: persona.enabled });
    return persona.enabled;
  }

  updatePersona(id: string, userId: string, updates: Partial<Persona>): Persona | undefined {
    const persona = this.personas.get(id);
    if (!persona || persona.userId !== userId) return undefined;
    Object.assign(persona, updates);
    return persona;
  }
}
