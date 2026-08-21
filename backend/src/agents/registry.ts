import { BaseAgent } from './base';
import { Persona } from '../types';
import { Server } from 'socket.io';

// ============ Agent Registry ============
export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private personas: Map<string, Persona> = new Map();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  register(persona: Persona, agentClass: new (persona: Persona, io: Server) => BaseAgent) {
    this.personas.set(persona.id, persona);
    const agent = new agentClass(persona, this.io);
    this.agents.set(persona.id, agent);
  }

  unregister(id: string): boolean {
    return this.agents.delete(id) && this.personas.delete(id);
  }

  get(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getEnabled(): BaseAgent[] {
    return this.getAll().filter(a => a.enabled);
  }

  getPersona(id: string): Persona | undefined {
    return this.personas.get(id);
  }

  getAllPersonas(): Persona[] {
    return Array.from(this.personas.values());
  }

  toggleAgent(id: string): boolean {
    const persona = this.personas.get(id);
    if (!persona) return false;
    persona.enabled = !persona.enabled;
    return persona.enabled;
  }

  updatePersona(id: string, updates: Partial<Persona>): Persona | undefined {
    const persona = this.personas.get(id);
    if (!persona) return undefined;
    Object.assign(persona, updates);
    return persona;
  }
}
