import { describe, it, expect } from 'vitest';
import { sandboxEval, BLOCKED_PATTERNS } from './codeExec';

async function expectBlocked(code: string, phrase = 'blocked pattern'): Promise<void> {
  const result = await sandboxEval(code, 2000);
  expect(result).toContain(phrase);
}

async function expectOk(code: string, expected: string): Promise<void> {
  const result = await sandboxEval(code, 2000);
  expect(result).toBe(expected);
}

describe('sandboxEval', () => {
  // ── Static pattern blocking ────────────────────────────────
  describe('static pattern blocking', () => {
    it('covers all BLOCKED_PATTERNS with non-empty source', () => {
      for (const p of BLOCKED_PATTERNS) {
        expect(p.source.length).toBeGreaterThan(0);
      }
    });

    it('blocks require()',                () => expectBlocked('return require("fs")'));
    it('blocks import()',                 () => expectBlocked('return import("fs")'));
    it('blocks eval()',                   () => expectBlocked('return eval("1+1")'));
    it('blocks new Function()',           () => expectBlocked('return new Function("return 1")()'));
    it('blocks process.env',              () => expectBlocked('return process.env'));
    it('blocks process.cwd()',            () => expectBlocked('return process.cwd()'));
    it('blocks child_process',            () => expectBlocked('return child_process'));
    it('blocks fs',                       () => expectBlocked('return fs'));
    it('blocks http',                     () => expectBlocked('return http'));
    it('blocks https',                    () => expectBlocked('return https'));
    it('blocks fetch()',                  () => expectBlocked('return fetch("http://evil.com")'));
    it('blocks navigator',                () => expectBlocked('return navigator'));
    it('blocks window',                   () => expectBlocked('return window'));
    it('blocks document',                 () => expectBlocked('return document'));
    it('blocks globalThis',               () => expectBlocked('return globalThis'));
    it('blocks global',                   () => expectBlocked('return global'));
    it('blocks constructor()',            () => expectBlocked('return constructor()'));
    it('blocks __proto__',                () => expectBlocked('return __proto__'));
    it('blocks .prototype.',              () => expectBlocked('return Array.prototype.map'));
    it('blocks Object.defineProperty',    () => expectBlocked('return Object.defineProperty(Object, null, {})'));
    it('blocks Object.setPrototypeOf',    () => expectBlocked('return Object.setPrototypeOf({}, null)'));
    it('blocks Object.create',            () => expectBlocked('return Object.create(null)'));
  });

  // ── Constructor escape attempts ────────────────────────────
  describe('constructor escape attempts', () => {
    it('blocks [].constructor.constructor',    () => expectBlocked('return [].constructor.constructor("return 1")()'));
    it('blocks "".constructor.constructor',    () => expectBlocked('return "".constructor.constructor("return 1")()'));
    it('blocks (1).constructor.constructor',   () => expectBlocked('return (1).constructor.constructor("return 1")()'));
    it('blocks /x/.constructor.constructor',   () => expectBlocked('return /x/.constructor.constructor("return 1")()'));
    it('blocks {}.constructor.constructor',    () => expectBlocked('return {}.constructor.constructor("return process")()'));
  });

  // ── Prototype pollution ────────────────────────────────────
  describe('prototype pollution', () => {
    it('blocks __proto__ assignment',          () => expectBlocked('return ({__proto__: null})'));
    it('blocks .prototype. access',            () => expectBlocked('return Array.prototype', 'blocked pattern'));
    it('blocks constructor chain to Function', () => expectBlocked('return {}.constructor.constructor("return process")()'));
  });

  // ── Timeout ────────────────────────────────────────────────
  describe('timeout', () => {
    it('kills infinite loops', async () => {
      const result = await sandboxEval('while(true){}', 700);
      expect(result).toContain('timed out');
    });

    it('kills code that takes too long', async () => {
      // Sync busy loop — high enough to exceed 600ms on any machine.
      const code = 'let x=0; for(let i=0;i<2_000_000_000;i++)x+=i; return x';
      const start = Date.now();
      const result = await sandboxEval(code, 700);
      const _elapsed = Date.now() - start;
      expect(result).toContain('timed out');
    });
  });

  // ── Valid computation ──────────────────────────────────────
  describe('valid computation', () => {
    it('evaluates simple arithmetic',  () => expectOk('return 2 + 3 * 4', '14'));
    it('evaluates array operations',   () => expectOk('return [1,2,3,4,5].map(x => x ** 2).join(",")', '1,4,9,16,25'));
    it('uses Math.sqrt',               () => expectOk('return Math.sqrt(144)', '12'));
    it('uses Math.max',                () => expectOk('return Math.max(1, 5, 3)', '5'));
    it('uses JSON.stringify',          () => expectOk('return JSON.stringify({a:1})', '{"a":1}'));
    it('uses JSON.parse',              () => expectOk("return JSON.parse('{\"a\":1}').a", '1'));
    it('uses parseInt / parseFloat',   () => { expectOk('return parseInt("42")', '42'); return expectOk('return parseFloat("3.14")', '3.14'); });
    it('uses String and Number',       () => { expectOk('return String(42)', '42'); return expectOk('return Number("42")', '42'); });
    it('uses Date.now',                async () => { const r = await sandboxEval('return Date.now()', 2000); expect(Number(r)).toBeGreaterThan(1_700_000_000_000); });
    it('uses RegExp',                  () => expectOk('return "hello".match(/l+/g).join("")', 'll'));
    it('uses Set',                     () => expectOk('return JSON.stringify([...new Set([1,2,2,3])])', '[1,2,3]'));
    it('uses Map',                     () => expectOk('const m = new Map(); m.set("k", 1); return m.get("k")', '1'));
    it('uses Promise.resolve',         () => expectOk('return Promise.resolve(42)', '42'));
    it('uses console.log (no crash)',  () => expectOk('console.log("hello"); return 1', '1'));

    it('handles multiline code', () =>
      expectOk('const a = [1,2,3];\nconst b = a.map(x => x * 2);\nconst sum = b.reduce((s, x) => s + x, 0);\nreturn sum', '12'));

    it('auto-wraps expression (no explicit return)', () => expectOk('42', '42'));
    it('handles undefined return',    () => expectOk('return undefined', '(undefined)'));
    it('handles null return',         () => expectOk('return null', '(null)'));

    it('handles object return via JSON.stringify', async () => {
      const result = await sandboxEval('return {x: 1, y: 2}', 2000);
      expect(JSON.parse(result)).toEqual({ x: 1, y: 2 });
    });

    it('rejects empty input', async () => {
      expect(await sandboxEval('')).toBe('Error: Code cannot be empty');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────
  describe('edge cases', () => {
    it('survives thrown Error', async () => {
      const result = await sandboxEval('throw new Error("boom")', 2000);
      expect(result).toContain('Error:');
      expect(result).toContain('boom');
    });

    it('survives reference error', async () => {
      const result = await sandboxEval('return nonexistentVar', 2000);
      expect(result).toContain('Error:');
    });

    // Global identifiers NOT explicitly blocked by the pattern set
    // (e.g. Buffer, setTimeout) ARE reachable inside the Function
    // constructor — that's by design.  The sandbox relies on the
    // blocked-pattern list + the LLM's tool instructions for safety.
    it('can use globals not in the blocked list (no false positives)', async () => {
      const result = await sandboxEval('return Math.min(7, 3)', 2000);
      expect(result).toBe('3');
    });
  });
});