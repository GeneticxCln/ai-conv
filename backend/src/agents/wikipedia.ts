import { Tool } from '@ai-conv/types';

const TIMEOUT_MS = 8_000;

const wikipediaTool: Tool = {
  name: 'wikipedia',
  description: 'Look up any topic on Wikipedia. Returns the article title, summary, and URL. Great for factual lookups on people, places, concepts, history, science, etc.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Topic to look up (e.g. "Albert Einstein", "photosynthesis", "World War II")' },
    },
    required: ['query'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const query = (params.query as string).trim();
    if (!query) return 'Error: Query cannot be empty';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      // Wikipedia REST API summary endpoint — free, no API key
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'AIConv/1.0 (https://github.com/aiconv)' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 404) {
        // Try search API to find the right article
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
        const searchResp = await fetch(searchUrl, {
          headers: { 'User-Agent': 'AIConv/1.0' },
        });
        const searchData: any = await searchResp.json();

        if (searchData?.query?.search?.length > 0) {
          const results = searchData.query.search
            .map((r: any) => `- ${r.title}: ${r.snippet.replace(/<[^>]+>/g, '')}`)
            .join('\n');
          return `No exact match for "${query}". Did you mean:\n${results}\n\nTry again with the exact title.`;
        }
        return `No Wikipedia article found for "${query}".`;
      }

      if (!response.ok) {
        return `Error: Wikipedia API returned ${response.status}`;
      }

      const data: any = await response.json();
      const parts: string[] = [];

      parts.push(`# ${data.title}`);
      if (data.description) parts.push(`*${data.description}*`);
      parts.push('');
      parts.push(data.extract || 'No summary available.');
      parts.push('');
      parts.push(`Source: ${data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`}`);

      return parts.join('\n');
    } catch (error: any) {
      if (error?.name === 'AbortError') return 'Error: Wikipedia request timed out';
      return `Error: ${error instanceof Error ? error.message : 'Wikipedia lookup failed'}`;
    }
  },
};

export { wikipediaTool };
