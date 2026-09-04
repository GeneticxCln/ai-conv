import { Persona } from '@ai-conv/types';
import { Server } from 'socket.io';
import { ToolRegistry } from './tools.js';
import { BaseAgent } from './base.js';
import { webSearchTool } from './webSearch.js';
import { urlFetcherTool } from './urlFetcher.js';
import { imageGenTool } from './imageGen.js';
import { datetimeTool } from './datetime.js';
import { calculatorTool } from './calculator.js';
import { wikipediaTool } from './wikipedia.js';
import { textUtilsTool } from './textUtils.js';
import { codeExecTool } from './codeExec.js';
import { jsonTool } from './jsonTool.js';
import { passwordTool } from './password.js';
import { uuidTool } from './uuidTool.js';
import { colorConvertTool } from './colorConvert.js';
import { base64Tool } from './base64Tool.js';
import { regexTool } from './regexTool.js';

export abstract class ToolEnabledAgent extends BaseAgent {
  protected toolRegistry: ToolRegistry;
  protected toolSystemPrompt: string;
  constructor(persona: Persona, io: Server) {
    super(persona, io);
    this.toolRegistry = new ToolRegistry();
    this.registerDefaultTools();
    this.toolSystemPrompt = this.buildSystemPrompt(persona.systemPrompt);
  }

  protected registerDefaultTools(): void {
    // Register real tools
    if (webSearchTool) {
      this.toolRegistry.register(webSearchTool);
    }
    if (urlFetcherTool) {
      this.toolRegistry.register(urlFetcherTool);
    }
    if (imageGenTool) {
      this.toolRegistry.register(imageGenTool);
    }
    this.toolRegistry.register(datetimeTool);
    this.toolRegistry.register(calculatorTool);
    this.toolRegistry.register(wikipediaTool);
    this.toolRegistry.register(textUtilsTool);
    this.toolRegistry.register(codeExecTool);
    this.toolRegistry.register(jsonTool);
    this.toolRegistry.register(passwordTool);
    this.toolRegistry.register(uuidTool);
    this.toolRegistry.register(colorConvertTool);
    this.toolRegistry.register(base64Tool);
    this.toolRegistry.register(regexTool);
  }

  protected buildSystemPrompt(basePrompt: string): string {
    const tools = this.toolRegistry.getSchemas();
    if (tools.length === 0) return basePrompt;

    const toolDescriptions = tools.map(t => 
      `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters)}`
    ).join('\n');

    return `${basePrompt}\n\nYou have access to the following tools:\n${toolDescriptions}\n\nWhen you need to use a tool, respond with a JSON object in this format:\n{\n  "tool_calls": [\n    { "name": "tool_name", "arguments": { "arg1": "value1", "arg2": "value2" } }\n  ]\n}\n\nOnly call tools when necessary. If no tool is needed, respond normally.`;
  }

  // Build messages with the tool-enhanced system prompt (callers call
  // super.streamResponse so they get correct messageId handling).
  protected buildMessages(
    history: any[],
    userMessage: string
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const mapped = history.map(m => ({
      role: m.role === 'agent' ? 'assistant' as const : m.role,
      content: m.content,
    }));
    const messages = userMessage
      ? [...mapped, { role: 'user' as const, content: userMessage }]
      : mapped;

    // Prepend system prompt with tool descriptions
    return [{ role: 'system' as const, content: this.toolSystemPrompt }, ...messages];
  }
}
