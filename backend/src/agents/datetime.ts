import { Tool } from '@ai-conv/types';

const datetimeTool: Tool = {
  name: 'current_datetime',
  description: 'Get the current date, time, timezone, and day of the week. Use this when the user asks about time, date, or day.',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone name (e.g. "America/New_York", "Europe/London", "Asia/Tokyo"). Defaults to UTC.',
      },
    },
    required: [],
  },
  async execute(params: Record<string, unknown>): Promise<string> {
    const tz = (params.timezone as string) || 'UTC';
    const now = new Date();

    try {
      const formatted = now.toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });

      const dateOnly = now.toLocaleDateString('en-US', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const timeOnly = now.toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });

      const iso = now.toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T');

      return `Current date and time (${tz}):\n${formatted}\n\nDate: ${dateOnly}\nTime: ${timeOnly}\nISO: ${iso}`;
    } catch {
      // Invalid timezone — fall back to UTC
      const formatted = now.toLocaleString('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
      return `Current date and time (UTC):\n${formatted}\n\nNote: Timezone "${tz}" was not recognized, showing UTC instead.`;
    }
  },
};

export { datetimeTool };
