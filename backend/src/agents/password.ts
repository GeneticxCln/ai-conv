import { Tool } from '@ai-conv/types';
import { randomInt } from 'crypto';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

function secureRandom(max: number): number {
  return randomInt(0, max);
}

function generatePassword(length: number, useUpper: boolean, useDigits: boolean, useSymbols: boolean): string {
  let charset = LOWERCASE;
  const required: string[] = [];

  if (useUpper) {
    charset += UPPERCASE;
    required.push(UPPERCASE[secureRandom(UPPERCASE.length)]);
  }
  if (useDigits) {
    charset += DIGITS;
    required.push(DIGITS[secureRandom(DIGITS.length)]);
  }
  if (useSymbols) {
    charset += SYMBOLS;
    required.push(SYMBOLS[secureRandom(SYMBOLS.length)]);
  }

  // Fill remaining length with random chars from full charset
  const remaining = length - required.length;
  const chars: string[] = [...required];
  for (let i = 0; i < remaining; i++) {
    chars.push(charset[secureRandom(charset.length)]);
  }

  // Shuffle using Fisher-Yates
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandom(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function estimateEntropy(length: number, charsetSize: number): number {
  return Math.floor(length * Math.log2(charsetSize));
}

const passwordTool: Tool = {
  name: 'generate_password',
  description: 'Generate a cryptographically secure random password. Returns the password with length and entropy info.',
  parameters: {
    type: 'object',
    properties: {
      length: { type: 'number', description: 'Password length (default: 16, min: 8, max: 128)' },
      uppercase: { type: 'boolean', description: 'Include uppercase letters (default: true)' },
      digits: { type: 'boolean', description: 'Include digits (default: true)' },
      symbols: { type: 'boolean', description: 'Include symbols (default: true)' },
    },
    required: [],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const length = Math.min(Math.max((params.length as number) || 16, 8), 128);
    const useUpper = params.uppercase !== false;
    const useDigits = params.digits !== false;
    const useSymbols = params.symbols !== false;

    const password = generatePassword(length, useUpper, useDigits, useSymbols);

    let charsetSize = 26; // lowercase
    if (useUpper) charsetSize += 26;
    if (useDigits) charsetSize += 10;
    if (useSymbols) charsetSize += SYMBOLS.length;

    const entropy = estimateEntropy(length, charsetSize);

    let strength = 'Weak';
    if (entropy >= 60) strength = 'Fair';
    if (entropy >= 80) strength = 'Strong';
    if (entropy >= 100) strength = 'Very Strong';

    return `Password: ${password}\nLength: ${length} characters\nEntropy: ${entropy} bits\nStrength: ${strength}`;
  },
};

export { passwordTool };
