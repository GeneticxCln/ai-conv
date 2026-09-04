import { Tool } from '@ai-conv/types';

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

const colorConvertTool: Tool = {
  name: 'color_convert',
  description: 'Convert colors between hex, RGB, and HSL formats. Provide any format and get all representations.',
  parameters: {
    type: 'object',
    properties: {
      color: {
        type: 'string',
        description: 'Color value in any format: hex (#ff5733), rgb (255, 87, 51), or hsl (9, 100%, 60%)',
      },
    },
    required: ['color'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const input = (params.color as string).trim().toLowerCase();
    if (!input) return 'Error: Color cannot be empty';

    let r: number, g: number, b: number;

    // Try hex
    const hexMatch = input.match(/^#?([a-f\d]{3,8})$/i);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      if (hex.length === 6) {
        const rgb = hexToRgb('#' + hex);
        if (rgb) { r = rgb.r; g = rgb.g; b = rgb.b; }
        else return `Error: Invalid hex color "${input}"`;
      } else return `Error: Invalid hex color "${input}"`;
    }
    // Try rgb
    else {
      const rgbMatch = input.match(/rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/);
      if (rgbMatch) {
        r = parseInt(rgbMatch[1]); g = parseInt(rgbMatch[2]); b = parseInt(rgbMatch[3]);
      } else {
        // Try hsl
        const hslMatch = input.match(/hsl\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})%?\s*,\s*(\d{1,3})%?\s*\)/);
        if (hslMatch) {
          const h = parseInt(hslMatch[1]), s = parseInt(hslMatch[2]), l = parseInt(hslMatch[3]);
          const rgb = hslToRgb(h, s, l);
          r = rgb.r; g = rgb.g; b = rgb.b;
        } else return `Error: Could not parse color "${input}". Use hex (#ff5733), rgb (255, 87, 51), or hsl (9, 100%, 60%).`;
      }
    }

    if (r! > 255 || g! > 255 || b! > 255) return 'Error: RGB values must be 0-255';

    const hex = rgbToHex(r!, g!, b!);
    const hsl = rgbToHsl(r!, g!, b!);

    return [
      `HEX: ${hex}`,
      `RGB: rgb(${r}, ${g}, ${b})`,
      `HSL: hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    ].join('\n');
  },
};

export { colorConvertTool };
