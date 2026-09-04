import { Tool } from '@ai-conv/types';

/**
 * Safely evaluate a math expression.
 * Supports: +, -, *, /, **, %, parentheses, Math functions (sqrt, abs, sin, cos, etc.),
 * and common constants (PI, E).
 *
 * Security: only allows digits, operators, parentheses, dots, spaces, and known math names.
 * No arbitrary code execution.
 */
const ALLOWED_MATH_FUNCS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  exp: Math.exp,
};

function safeMathEval(expr: string): number {
  let pos = 0;
  const str = expr
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');

  function parseNumber(): number {
    const start = pos;
    while (pos < str.length && /[0-9.]/.test(str[pos])) pos++;
    if (start === pos) throw new Error(`Expected number at position ${pos}`);
    const num = parseFloat(str.slice(start, pos));
    if (Number.isNaN(num)) throw new Error(`Invalid number at position ${start}`);
    return num;
  }

  function parseIdentifier(): string {
    const start = pos;
    while (pos < str.length && /[a-zA-Z0-9_]/.test(str[pos])) pos++;
    return str.slice(start, pos);
  }

  function parsePrimary(): number {
    if (pos >= str.length) throw new Error('Unexpected end of expression');
    if (str[pos] === '(') {
      pos++;
      const val = parseExpression();
      if (str[pos] !== ')') throw new Error(`Expected closing parenthesis at position ${pos}`);
      pos++;
      return val;
    }
    if (/[0-9.]/.test(str[pos])) {
      return parseNumber();
    }
    if (/[a-zA-Z_]/.test(str[pos])) {
      const id = parseIdentifier();
      const lowerId = id.toLowerCase();
      if (id === 'PI' || lowerId === 'pi' || id === 'π') return Math.PI;
      if (id === 'E' || lowerId === 'e') return Math.E;
      if (str[pos] === '(') {
        pos++;
        const args: number[] = [];
        if (str[pos] !== ')') {
          args.push(parseExpression());
          while (str[pos] === ',') {
            pos++;
            args.push(parseExpression());
          }
        }
        if (str[pos] !== ')') throw new Error('Expected ) after function arguments');
        pos++;
        const fn = ALLOWED_MATH_FUNCS[lowerId];
        if (!fn) throw new Error(`Unknown or disallowed math function: ${id}`);
        return fn(...args);
      }
      throw new Error(`Unknown identifier: ${id}`);
    }
    throw new Error(`Unexpected character: ${str[pos]}`);
  }

  function parseUnary(): number {
    if (str[pos] === '+') {
      pos++;
      return parseUnary();
    }
    if (str[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePower(): number {
    const left = parseUnary();
    if (str.slice(pos, pos + 2) === '**') {
      pos += 2;
      const right = parsePower();
      return Math.pow(left, right);
    }
    if (str[pos] === '^') {
      pos++;
      const right = parsePower();
      return Math.pow(left, right);
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (pos < str.length && (str[pos] === '*' || str[pos] === '/' || str[pos] === '%')) {
      const op = str[pos];
      if (op === '*' && str[pos + 1] === '*') break;
      pos++;
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else if (op === '%') {
        left %= right;
      }
    }
    return left;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
      const op = str[pos];
      pos++;
      const right = parseTerm();
      if (op === '+') left += right;
      else left -= right;
    }
    return left;
  }

  const result = parseExpression();
  if (pos < str.length) throw new Error(`Unexpected character at end of expression: ${str[pos]}`);
  if (!Number.isFinite(result)) throw new Error('Expression did not produce a finite number');
  return result;
}

const calculatorTool: Tool = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression. Supports basic arithmetic (+, -, *, /, **, %), parentheses, and Math functions (sqrt, abs, sin, cos, tan, log, ceil, floor, round, pow, min, max). Example: "sqrt(144) + 3 * 2"',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'The math expression to evaluate, e.g. "2 + 3 * 4", "sqrt(144)", "sin(PI/2)"',
      },
    },
    required: ['expression'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const expr = (params.expression as string).trim();

    if (!expr) {
      return 'Error: Expression cannot be empty';
    }

    try {
      const result = safeMathEval(expr);

      // Format nicely: remove trailing zeros for clean output
      const formatted = Number.isInteger(result) ? result.toString() : parseFloat(result.toFixed(10)).toString();

      return `${expr} = ${formatted}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : 'Could not evaluate expression'}. Example: "2 + 3 * 4" or "sqrt(144)"`;
    }
  },
};

export { calculatorTool };
