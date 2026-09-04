import { Tool } from '@ai-conv/types';

const jsonTool: Tool = {
  name: 'json_format',
  description: 'Format, validate, minify, or query JSON data. Use to pretty-print JSON, check if it is valid, extract values by key path, or compact it.',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The JSON string to operate on' },
      operation: {
        type: 'string',
        description: 'Operation: pretty (default), minify, validate, get (extract a value by dot-path key like "user.name")',
      },
      key: { type: 'string', description: 'Dot-path key for get operation, e.g. "users.0.name" or "config.debug"' },
    },
    required: ['input'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const input = (params.input as string).trim();
    const op = ((params.operation as string) || 'pretty').toLowerCase().trim();
    const key = params.key as string | undefined;

    if (!input) return 'Error: Input cannot be empty';

    let parsed: any;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      return `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`;
    }

    switch (op) {
      case 'pretty':
        return JSON.stringify(parsed, null, 2);
      case 'minify':
        return JSON.stringify(parsed);
      case 'validate':
        return `Valid JSON. Type: ${Array.isArray(parsed) ? 'array' : typeof parsed}${Array.isArray(parsed) ? ` (${parsed.length} items)` : ''}`;
      case 'get': {
        if (!key) return 'Error: "key" parameter is required for get operation';
        const parts = key.split('.');
        let current = parsed;
        for (const part of parts) {
          if (current === null || current === undefined) {
            return `Key path "${key}" not found: reached ${current} at "${part}"`;
          }
          // Handle array index
          if (Array.isArray(current) && /^\d+$/.test(part)) {
            current = current[parseInt(part)];
          } else if (typeof current === 'object') {
            current = current[part];
          } else {
            return `Key path "${key}" not found: cannot traverse ${typeof current} at "${part}"`;
          }
        }
        if (current === undefined) return `Key "${key}" not found`;
        if (typeof current === 'object') return JSON.stringify(current, null, 2);
        return String(current);
      }
      default:
        return `Unknown operation "${op}". Available: pretty, minify, validate, get`;
    }
  },
};

export { jsonTool };
