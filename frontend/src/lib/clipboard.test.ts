import { describe, expect, it } from 'vitest';
import { readClipboardText, replaceSelection, writeClipboardText } from './clipboard';

describe('replaceSelection', () => {
  it('replaces the selected range and places the cursor after it', () => {
    expect(replaceSelection('hello world', 6, 11, 'AI')).toEqual({
      value: 'hello AI',
      cursor: 8,
    });
  });

  it('inserts text when the selection is collapsed', () => {
    expect(replaceSelection('helloworld', 5, 5, ' ')).toEqual({
      value: 'hello world',
      cursor: 6,
    });
  });

  it('clamps invalid selection boundaries safely', () => {
    expect(replaceSelection('abc', -10, 99, 'x')).toEqual({
      value: 'x',
      cursor: 1,
    });
  });
});

describe('clipboard fallbacks', () => {
  it('returns false when writing is unavailable outside a document', async () => {
    await expect(writeClipboardText('hello')).resolves.toBe(false);
  });

  it('returns null when reading is unavailable', async () => {
    await expect(readClipboardText()).resolves.toBeNull();
  });
});
