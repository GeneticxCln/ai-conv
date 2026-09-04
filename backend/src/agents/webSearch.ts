import { Tool } from '@ai-conv/types';

const USER_AGENT = 'Mozilla/5.0 (compatible; AIConv/1.0)';
const TIMEOUT_MS = 8_000;

/**
 * Extract the real destination URL from a DuckDuckGo redirect link.
 * DuckDuckGo wraps results in /l/?uddg=ENCODED_URL.
 */
function extractRedirectUrl(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch { /* ignore */ }
  return href;
}

/**
 * Parse DuckDuckGo HTML search results from raw HTML.
 * Extracts title, URL, and snippet for each result.
 */
function parseHtmlResults(html: string, maxResults: number): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // Match each result block: <a class="result__a" href="...">TITLE</a>
  // followed by <a class="result__snippet">SNIPPET</a>
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const rawHref = match[1];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    const snippet = match[3].replace(/<[^>]+>/g, '').trim();

    if (title && snippet) {
      results.push({
        title,
        url: extractRedirectUrl(rawHref),
        snippet,
      });
    }
  }

  return results;
}

const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for current information using DuckDuckGo',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 5)' },
    },
    required: ['query'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const query = params.query as string;
    const maxResults = Math.min((params.maxResults as number) || 5, 10);

    try {
      // 1. Try DuckDuckGo HTML search (returns real results)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const htmlResponse = await fetch(htmlUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (htmlResponse.ok) {
        const html = await htmlResponse.text();
        const results = parseHtmlResults(html, maxResults);

        if (results.length > 0) {
          return results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
            .join('\n\n');
        }
      }

      // 2. Fallback: DuckDuckGo instant answer API
      const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const iaResponse = await fetch(iaUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data: any = await iaResponse.json();

      const fallback: string[] = [];
      if (data.AbstractText) fallback.push(data.AbstractText);
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults)) {
          if (typeof topic === 'object' && topic.Text) {
            fallback.push(topic.Text);
          }
        }
      }

      if (fallback.length > 0) {
        return fallback.slice(0, maxResults).join('\n\n');
      }

      return 'No results found.';
    } catch (error) {
      return `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
};

export function registerWebSearchTool(registry: any) {
  if (registry && typeof registry.register === 'function') {
    registry.register(webSearchTool);
  }
}

export { webSearchTool };
