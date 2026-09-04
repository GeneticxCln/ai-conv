import { promises as dns, lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import { Tool } from '@ai-conv/types';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTENT_LENGTH = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; AIConv/1.0)';

type CustomLookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

const safeDispatcher = new Agent({
  connect: {
    lookup: (
      hostname: string,
      options: unknown,
      callback?: CustomLookupCallback
    ) => {
      const cb = (typeof options === 'function' ? options : callback) as CustomLookupCallback;
      const opts = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
      dnsLookup(hostname, { ...opts, all: false }, (err, address, family) => {
        if (err) return cb(err, '');
        if (isPrivateIp(String(address))) {
          return cb(new Error(`Access to internal/private IP address (${address}) is blocked`), '');
        }
        cb(null, String(address), family);
      });
    },
  },
});

function stripBoilerplate(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function extractText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|pre|article|section|main)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

/** Return true for private, local, link-local, multicast, or malformed IPs. */
export function isPrivateIp(ip: string): boolean {
  const normalizedInput = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(normalizedInput);
  if (family === 4) {
    ip = normalizedInput;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    return false;
  }

  if (family === 6) {
    const normalized = normalizedInput;
    if (normalized === '::' || normalized === '::1') return true;
    // IPv4-mapped IPv6 addresses can be normalized by URL parsers to hex.
    const mapped = normalized.match(/::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i);
    if (mapped) {
      const address = mapped[1] || [mapped[2], mapped[3]].map((part) => parseInt(part, 16)).flatMap((value) => [value >> 8, value & 0xff]).join('.');
      return isPrivateIp(address);
    }
    // Unique-local, link-local, multicast, and unspecified IPv6 ranges.
    const firstGroup = parseInt(normalized.split(':').filter(Boolean)[0] || '0', 16);
    return (firstGroup & 0xfe00) === 0xfc00
      || (firstGroup & 0xffc0) === 0xfe80
      || (firstGroup & 0xff00) === 0xff00;
  }

  return true;
}

async function validateTarget(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Only http/https URLs are supported, got ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) throw new Error('URLs with embedded credentials are not supported');

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Local hostnames are blocked');
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`Access to internal/private IP address (${hostname}) is blocked`);
    return parsed;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve hostname "${hostname}"`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`Access to internal/private host "${hostname}" is blocked`);
  }
  return parsed;
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Response exceeded the maximum size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function fetchWithoutUnsafeRedirects(startUrl: string): Promise<{ response: Response; url: URL; cleanup: () => void }> {
  let current = await validateTarget(startUrl);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'manual',
        dispatcher: safeDispatcher,
      } as unknown as RequestInit);
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (!isRedirect) return { response, url: current, cleanup: () => clearTimeout(timeout) };

    clearTimeout(timeout);
    const location = response.headers.get('location');
    if (!location) throw new Error(`HTTP ${response.status} redirect had no Location header`);
    if (redirectCount >= MAX_REDIRECTS) throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`);

    const next = new URL(location, current).toString();
    current = await validateTarget(next);
  }
}

const urlFetcherTool: Tool = {
  name: 'fetch_url',
  description: 'Fetch a webpage URL and extract its readable text content. Redirect targets are validated before they are requested.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
      maxLength: { type: 'number', description: 'Max characters to return (default: 10000)' },
    },
    required: ['url'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const rawUrl = params.url;
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return 'Error: Invalid URL';
    const maxLen = Math.min(
      typeof params.maxLength === 'number' && Number.isFinite(params.maxLength) ? params.maxLength : MAX_CONTENT_LENGTH,
      MAX_CONTENT_LENGTH,
    );

    try {
      const fetched = await fetchWithoutUnsafeRedirects(rawUrl);
      const { response, url } = fetched;
      try {
        if (!response.ok) return `Error: HTTP ${response.status} ${response.statusText}`;

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
          return `Error: Unsupported content type "${contentType}". Can only read HTML/text pages.`;
        }

        let body = await readBody(response);
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          const title = extractTitle(body);
          body = extractText(stripBoilerplate(body));
          if (title) body = `# ${title}\n\n${body}`;
        }

        if (body.length > maxLen) body = `${body.slice(0, maxLen)}\n\n[Truncated at ${maxLen} characters]`;
        return body.length > 0 ? body : `No readable content found at ${url.href}.`;
      } finally {
        fetched.cleanup();
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') return `Error: Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
      return `Error: ${error instanceof Error ? error.message : 'Failed to fetch URL'}`;
    }
  },
};

export { urlFetcherTool };
