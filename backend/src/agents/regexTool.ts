import { Worker } from 'node:worker_threads';
import { Tool } from '@ai-conv/types';

const MAX_PATTERN_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_MATCHES = 50;
const TIMEOUT_MS = 2_000;

interface RegexWorkerResult {
  ok: boolean;
  output?: string;
  error?: string;
}

function runRegexInWorker(pattern: string, text: string, flags: string): Promise<string> {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    try {
      const regex = new RegExp(workerData.pattern, workerData.flags);
      const matches = [];
      let match;
      let count = 0;
      if (regex.global) {
        while ((match = regex.exec(workerData.text)) !== null) {
          count += 1;
          if (count > ${MAX_MATCHES}) {
            matches.push('... and more (limited to ${MAX_MATCHES} matches)');
            break;
          }
          const parts = [\`Match \${count}: "\${match[0]}" at index \${match.index}\`];
          for (let i = 1; i < match.length; i += 1) {
            if (match[i] !== undefined) parts.push(\`  Group \${i}: "\${match[i]}"\`);
          }
          matches.push(parts.join('\\n'));
          if (match[0].length === 0) regex.lastIndex += 1;
        }
      } else {
        match = regex.exec(workerData.text);
        if (match) {
          count = 1;
          const parts = [\`Match 1: "\${match[0]}" at index \${match.index}\`];
          for (let i = 1; i < match.length; i += 1) {
            if (match[i] !== undefined) parts.push(\`  Group \${i}: "\${match[i]}"\`);
          }
          matches.push(parts.join('\\n'));
        }
      }
      const output = count === 0
        ? \`No matches found for pattern /\${workerData.pattern}/\${workerData.flags}\`
        : \`Found \${count} match\${count !== 1 ? 'es' : ''}:\\n\\n\${matches.join('\\n')}\`;
      parentPort.postMessage({ ok: true, output });
    } catch (error) {
      parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Invalid regex' });
    }
  `;

  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { pattern, text, flags },
    });
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      resolve(result);
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(`Error: Regex execution timed out after ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);

    worker.once('message', (result: RegexWorkerResult) => {
      clearTimeout(timer);
      finish(result.ok ? result.output || '' : `Error: Invalid regex — ${result.error || 'unknown error'}`);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      finish(`Error: Regex execution failed — ${error.message}`);
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        finish('Error: Regex execution failed');
      }
    });
  });
}

const regexTool: Tool = {
  name: 'regex_test',
  description: 'Test a regular expression against text in an isolated, time-bounded worker. This tool only matches text; it does not execute JavaScript.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The regex pattern without delimiters' },
      text: { type: 'string', description: 'The text to test against' },
      flags: { type: 'string', description: 'Regex flags such as g, i, m, s, u, or y. Default: g' },
    },
    required: ['pattern', 'text'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const pattern = params.pattern;
    const text = params.text;
    if (typeof pattern !== 'string' || pattern.length === 0) return 'Error: Pattern cannot be empty';
    if (typeof text !== 'string' || text.length === 0) return 'Error: Text cannot be empty';
    if (pattern.length > MAX_PATTERN_LENGTH) return `Error: Pattern exceeds ${MAX_PATTERN_LENGTH} characters`;
    if (text.length > MAX_TEXT_LENGTH) return `Error: Text exceeds ${MAX_TEXT_LENGTH} characters`;

    const requestedFlags = typeof params.flags === 'string' && params.flags.length > 0 ? params.flags : 'g';
    if (!/^[dgimsuvy]*$/.test(requestedFlags) || new Set(requestedFlags).size !== requestedFlags.length) {
      return 'Error: Invalid regex flags';
    }
    return runRegexInWorker(pattern, text, requestedFlags);
  },
};

export { regexTool };
