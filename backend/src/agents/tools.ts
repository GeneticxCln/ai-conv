import { Tool, ToolCall, ToolResult } from '@ai-conv/types';


export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getSchemas(): Array<{ name: string; description: string; parameters: Tool['parameters'] }> {
    return this.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { name: call.name, result: '', error: `Tool ${call.name} not found` };
    }
    try {
      const result = await tool.execute(call.arguments);
      return { name: call.name, result };
    } catch (error) {
      return { name: call.name, result: '', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

export const toolRegistry = new ToolRegistry();
