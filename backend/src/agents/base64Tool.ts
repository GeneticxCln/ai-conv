import { Tool } from '@ai-conv/types';

const base64Tool: Tool = {
  name: 'base64',
  description: 'Encode or decode Base64 strings. Useful for encoding data, decoding tokens, or working with binary-safe text.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to encode or decode' },
      operation: { type: 'string', description: '"encode" or "decode" (default: auto-detect)' },
    },
    required: ['text'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const text = (params.text as string).trim();
    const op = (params.operation as string)?.toLowerCase().trim();

    if (!text) return 'Error: Text cannot be empty';

    // Explicit operation takes priority. Default to encode to avoid false positives
    // on short words that happen to match the base64 pattern.
    const shouldDecode = op === 'decode';

    if (shouldDecode) {
      try {
        const decoded = Buffer.from(text, 'base64').toString('utf-8');
        // Check if decoded result is valid text (no null bytes)
        if (decoded.includes('\0')) return 'Error: Input looks like base64 but decoded to binary data, not text.';
        return decoded;
      } catch {
        return 'Error: Failed to decode Base64 string';
      }
    }

    // Default: encode
    try {
      const encoded = Buffer.from(text, 'utf-8').toString('base64');
      return encoded;
    } catch {
      return 'Error: Failed to encode to Base64';
    }
  },
};

export { base64Tool };
