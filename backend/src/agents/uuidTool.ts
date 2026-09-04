import { Tool } from '@ai-conv/types';
import { randomUUID } from 'crypto';

const uuidTool: Tool = {
  name: 'generate_uuid',
  description: 'Generate one or more UUIDs (v4 random). Use when the user needs unique identifiers.',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of UUIDs to generate (default: 1, max: 20)' },
    },
    required: [],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const count = Math.min(Math.max((params.count as number) || 1, 1), 20);
    const uuids = Array.from({ length: count }, () => randomUUID());
    if (count === 1) return uuids[0];
    return uuids.join('\n');
  },
};

export { uuidTool };
