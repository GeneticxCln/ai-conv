import { Tool } from '@ai-conv/types';

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const FETCH_TIMEOUT_MS = 30_000;

const imageGenTool: Tool = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt using external Pollinations.ai service. Returns a URL to the generated image. Note: Prompts are sent over the internet to pollinations.ai.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to generate' },
      width: { type: 'number', description: 'Image width in pixels (default: 1024)' },
      height: { type: 'number', description: 'Image height in pixels (default: 1024)' },
    },
    required: ['prompt'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const prompt = (params.prompt as string).trim();
    const width = Math.min(Math.max((params.width as number) || 1024, 256), 2048);
    const height = Math.min(Math.max((params.height as number) || 1024, 256), 2048);

    if (!prompt) {
      return 'Error: Prompt cannot be empty';
    }

    // Pollinations.ai generates images via a simple URL — no API key needed.
    // The image is generated on-demand when the URL is fetched.
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const imageUrl = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

    try {
      // Verify the image actually generates (don't just return a broken URL)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(imageUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return `Error: Image generation failed (HTTP ${response.status}). Try a different prompt.`;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('image/')) {
        return `Error: Unexpected response type "${contentType}". Image generation may have failed.`;
      }

      return `Generated image via Pollinations.ai (external service): ${imageUrl}\n\nPrompt: "${prompt}" (${width}x${height})`;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return `Error: Image generation timed out after ${FETCH_TIMEOUT_MS / 1000}s. The service may be busy — try again.`;
      }
      return `Error: ${error instanceof Error ? error.message : 'Image generation failed'}`;
    }
  },
};

export { imageGenTool };
