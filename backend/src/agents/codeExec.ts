import { Worker } from 'node:worker_threads';
import { Tool } from '@ai-conv/types';

const TIMEOUT_MS = 5_000;
const MAX_CODE_LENGTH = 20_000;

// Defense in depth only. Isolation comes from the VM context and worker.
export const BLOCKED_PATTERNS: RegExp[] = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bprocess\s*\./,
  /\bchild_process\b/,
  /\bfs\b/,
  /\bfetch\s*\(/,
  /\bhttps?\b/,
  /\bnavigator\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\bconstructor\s*\(/,
  /\bconstructor\s*\[/,
  /\b__proto__\b/,
  /\.prototype\.?/,
  /Object\.(?:defineProperty|defineProperties|setPrototypeOf|create)\s*\(/,
];

function formatResult(value: unknown): string {
  if (value === undefined) return '(undefined)';
  if (value === null) return '(null)';
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

function runInWorker(body: string, timeoutMs: number): Promise<string> {
  const workerSource = `
    const vm = require('node:vm');
    const { parentPort, workerData } = require('node:worker_threads');

    const safeConsole = Object.freeze({ log() {}, warn() {}, error() {} });
    Object.freeze(Object.prototype);
    Object.freeze(Array.prototype);
    Object.freeze(Function.prototype);
    const sandbox = {
      Array, Boolean, BigInt, Date, Error, JSON, Map, Math, Number, Object,
      Promise, RegExp, Set, String, Symbol, TypeError, isFinite, isNaN,
      parseFloat, parseInt, console: safeConsole,
    };
    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    (async () => {
      try {
        const script = new vm.Script(\`(async () => { \${workerData.body} })()\`, {
          filename: 'ai-conv-computation',
        });
        const result = await script.runInContext(context, { timeout: workerData.timeoutMs });
        parentPort.postMessage({ ok: true, value: result });
      } catch (error) {
        parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  `;

  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { body, timeoutMs },
    });
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      resolve(result);
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(`Error: Execution timed out after ${timeoutMs / 1000}s`), timeoutMs);

    worker.once('message', (message: { ok: boolean; value?: unknown; error?: string }) => {
      clearTimeout(timer);
      finish(message.ok ? formatResult(message.value) : `Error: ${message.error || 'Execution failed'}`);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      finish(`Error: ${error.message || 'Worker error'}`);
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        finish('Error: Execution failed');
      }
    });
  });
}

export async function sandboxEval(code: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const trimmed = code.trim();
  if (!trimmed) return 'Error: Code cannot be empty';
  if (trimmed.length > MAX_CODE_LENGTH) return `Error: Code exceeds ${MAX_CODE_LENGTH} characters`;

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `Error: Code contains blocked pattern "${pattern.source}". Only pure computation is allowed.`;
    }
  }

  const statement = /^(while|if|for|throw|try|switch|const|let|var|function|class|do|break|continue|debugger)\b/;
  const body = !/\breturn\b/.test(trimmed) && !statement.test(trimmed)
    ? `return ${trimmed};`
    : trimmed;
  return runInWorker(body, timeoutMs);
}

const codeExecTool: Tool = {
  name: 'execute_js',
  description: 'Execute pure JavaScript computation in an isolated, time-bounded VM. No filesystem, network, process, module, or dynamic code generation access is available.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript computation. It may contain declarations and should return a value.',
      },
    },
    required: ['code'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    return sandboxEval(typeof params.code === 'string' ? params.code : '');
  },
};

export { codeExecTool };
