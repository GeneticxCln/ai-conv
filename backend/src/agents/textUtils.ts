import { Tool } from '@ai-conv/types';

const textUtilsTool: Tool = {
  name: 'text_utils',
  description: 'Perform text operations: count words/characters, get reading time, convert case, reverse text, generate slug, extract emails/URLs.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text to operate on' },
      operation: {
        type: 'string',
        description: 'Operation to perform: word_count, char_count, reading_time, upper, lower, title, sentence, reverse, slugify, extract_emails, extract_urls, truncate',
      },
      maxLength: { type: 'number', description: 'Max length for truncate operation (default: 100)' },
    },
    required: ['text', 'operation'],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const text = params.text as string;
    const op = (params.operation as string).toLowerCase().trim();
    const maxLen = (params.maxLength as number) || 100;

    if (!text) return 'Error: Text cannot be empty';

    switch (op) {
      case 'word_count': {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const chars = text.length;
        const charsNoSpaces = text.replace(/\s/g, '').length;
        const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length;
        const readingMin = Math.max(1, Math.ceil(words / 200));
        return `Words: ${words}\nCharacters: ${chars}\nCharacters (no spaces): ${charsNoSpaces}\nSentences: ${sentences}\nParagraphs: ${paragraphs}\nEst. reading time: ${readingMin} min`;
      }
      case 'char_count':
        return `Characters: ${text.length}\nCharacters (no spaces): ${text.replace(/\s/g, '').length}`;
      case 'reading_time': {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const minutes = Math.max(1, Math.ceil(words / 200));
        return `Words: ${words}\nEst. reading time: ${minutes} minute${minutes !== 1 ? 's' : ''}`;
      }
      case 'upper':
        return text.toUpperCase();
      case 'lower':
        return text.toLowerCase();
      case 'title':
        return text.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      case 'sentence':
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
      case 'reverse':
        return text.split('').reverse().join('');
      case 'slugify':
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      case 'extract_emails': {
        const emails = [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];
        return emails.length ? emails.join('\n') : 'No email addresses found.';
      }
      case 'extract_urls': {
        // Match URLs, excluding trailing punctuation
        const urls = [...new Set(text.match(/https?:\/\/[^\s<>"{}|^`\]]+/g) || [])];
        return urls.length ? urls.join('\n') : 'No URLs found.';
      }
      case 'truncate':
        if (text.length <= maxLen) return text;
        return text.slice(0, maxLen) + '...';
      default:
        return `Unknown operation "${op}". Available: word_count, char_count, reading_time, upper, lower, title, sentence, reverse, slugify, extract_emails, extract_urls, truncate`;
    }
  },
};

export { textUtilsTool };
