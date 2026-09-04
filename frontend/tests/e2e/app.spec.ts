import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test.describe('AI Conv core flows', () => {
  // global-setup picks the fastest installed chat model and writes its name to
  // tests/.auth/model.json. Prefer that; fall back to the first non-embedding
  // dropdown option only when the file is missing (e.g. running the spec
  // directly without global-setup).
  let chosenModel: string | null | undefined;
  async function getChosenModel(): Promise<string | null> {
    if (chosenModel !== undefined) return chosenModel;
    try {
      const raw = await readFile(path.resolve(process.cwd(), 'tests/.auth/model.json'), 'utf8');
      const parsed = JSON.parse(raw) as { name?: string };
      chosenModel = parsed.name || null;
    } catch {
      chosenModel = null;
    }
    return chosenModel;
  }

  // Open the persona modal, fill it in, pick the fastest installed chat-capable
  // model (never hardcoded), and create the persona.
  async function createPersona(page: Page, name: string, systemPrompt: string) {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New Persona' })).toBeVisible();
    await page.getByPlaceholder('e.g. Alex').fill(name);
    await page.getByPlaceholder('Describe how this persona talks and behaves...').fill(systemPrompt);
    const select = page.locator('select');
    const model = await getChosenModel();
    if (model) {
      // selectOption dispatches the change event the form listens for, and
      // waits for the option to exist — no race with async model loading.
      await select.selectOption(model, { timeout: 30_000 });
    } else {
      // Fallback: skip embedding models like nomic-embed-text (cannot chat).
      await select.evaluate((selectEl) => {
        const options = Array.from((selectEl as HTMLSelectElement).options);
        const pick = options.find((o) => !/embed/i.test(o.value)) || options[0];
        (selectEl as HTMLSelectElement).value = pick.value;
        (selectEl as HTMLSelectElement).dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }

  // Wait for the agent's streamed response. Agent bubbles render inside
  // .markdown-body, which only exists once the message has non-empty content;
  // user messages are plain <p> elements, so this locator is unambiguous.
  async function waitForAgentResponse(page: Page, timeout = 120_000) {
    const bubble = page.locator('.markdown-body').last();
    await expect(bubble).toBeVisible({ timeout });
    await expect(bubble).not.toBeEmpty();
    await expect(bubble).toContainText(/\S/);
    return bubble;
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'AI Conv' })).toBeVisible();
  });

  test('loads the authenticated main page', async ({ page }) => {
    await expect(page.getByText('Multi-Persona Messenger')).toBeVisible();
    await expect(page.getByText('No conversation selected')).toBeVisible();
    await expect(page.getByText('Connected')).toBeVisible();
  });

  test('creates a conversation', async ({ page }) => {
    await page.getByRole('button', { name: 'New Conversation' }).first().click();
    await expect(page.getByText('No messages yet')).toBeVisible();
  });

  test('opens settings and switches tabs', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Models' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Data' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Advanced' })).toBeVisible();

    await page.getByRole('tab', { name: 'Models' }).click();
    await expect(page.getByText('Installed Models')).toBeVisible();

    const modelRows = page.getByTestId('installed-model-row');
    await expect(modelRows.first()).toBeVisible({ timeout: 30_000 });
    const installedModels = await modelRows.evaluateAll((rows) => rows.map((row) => ({
      name: row.getAttribute('data-model-name') || '',
      parameterSize: row.getAttribute('data-parameter-size') || '',
      fileSize: Number(row.getAttribute('data-model-size') || 0),
      capabilities: (row.getAttribute('data-model-capabilities') || '').split(',').filter(Boolean),
      hasFastestBadge: Boolean(row.querySelector('[data-testid="fastest-model-badge"]')),
      hasEmbeddingBadge: Boolean(row.querySelector('[data-testid="embedding-model-badge"]')),
    })));

    const parseParameterSize = (value: string): number => {
      const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmMbB]?)/.exec(value);
      if (!match) return Number.POSITIVE_INFINITY;
      const parsed = Number.parseFloat(match[1]);
      if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
      switch (match[2].toLowerCase()) {
        case 'm': return parsed / 1_000;
        case 'k': return parsed / 1_000_000;
        default: return parsed;
      }
    };
    const isEmbedding = (model: typeof installedModels[number]) =>
      model.capabilities.includes('embedding') || /embed/i.test(model.name);
    const chatModels = installedModels.filter((model) => !isEmbedding(model));
    expect(chatModels.length).toBeGreaterThan(0);
    const expectedFastest = [...chatModels].sort((a, b) => {
      const parameterDelta = parseParameterSize(a.parameterSize) - parseParameterSize(b.parameterSize);
      return parameterDelta || a.fileSize - b.fileSize;
    })[0];
    expect(installedModels.filter((model) => model.hasFastestBadge).map((model) => model.name))
      .toEqual([expectedFastest.name]);

    const embeddingModels = installedModels.filter(isEmbedding);
    expect(embeddingModels.length).toBeGreaterThan(0);
    expect(embeddingModels.every((model) => model.hasEmbeddingBadge && !model.hasFastestBadge)).toBe(true);
    expect(installedModels.filter((model) => model.hasEmbeddingBadge).map((model) => model.name))
      .toEqual(embeddingModels.map((model) => model.name));

    await page.getByRole('tab', { name: 'Data' }).click();
    await expect(page.getByText('Export All Data (JSON)')).toBeVisible();
    await page.getByRole('tab', { name: 'Advanced' }).click();
    await expect(page.getByText('Danger Zone')).toBeVisible();
    await page.getByRole('button', { name: 'Close settings' }).click();
  });

  test('exports the active profile data', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Data' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export All Data (JSON)' }).click();
    await expect((await download).suggestedFilename()).toMatch(/^aiconv-export-\d{4}-\d{2}-\d{2}\.json$/);
  });

  test('sends a message in a conversation', async ({ page }) => {
    await page.getByRole('button', { name: 'New Conversation' }).first().click();
    const input = page.getByPlaceholder('Type a message... (Shift+Enter for new line)');
    await input.fill('Hello, world!');
    await input.press('Enter');
    // The conversation is auto-titled from the first message, so the text
    // appears both as the sidebar title and the message bubble. Scope the
    // assertion to the message bubble only.
    await expect(page.getByRole('paragraph').filter({ hasText: 'Hello, world!' }).first()).toBeVisible();
  });

  test('toggles dark mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ });
    const before = await toggle.getAttribute('aria-label');
    await toggle.click();
    await expect(toggle).not.toHaveAttribute('aria-label', before || '');
  });

  // End-to-end: create a persona, create a conversation, send a message, and
  // wait for the agent to stream a real response back from Ollama.
  test('full flow: persona → conversation → streamed response', async ({ page }) => {
    test.setTimeout(180_000);

    await createPersona(
      page,
      'FlowBot',
      'You are a terse assistant. Answer in at most one short sentence.',
    );

    await page.getByRole('button', { name: 'New Conversation' }).first().click();
    await expect(page.getByText('No messages yet')).toBeVisible();

    const input = page.getByPlaceholder('Type a message... (Shift+Enter for new line)');
    await input.fill('Reply with the word pong and nothing else.');
    await input.press('Enter');

    // The user's own message renders immediately.
    await expect(
      page.getByRole('paragraph').filter({ hasText: 'Reply with the word pong' }).first()
    ).toBeVisible();

    await waitForAgentResponse(page);
  });

  // Multi-turn context: the second question only has a correct answer if the
  // agent remembers the first exchange. Assert the second response echoes the
  // secret word planted in turn one.
  test('multi-turn: agent remembers the earlier exchange', async ({ page }) => {
    test.setTimeout(240_000);

    await createPersona(
      page,
      'MemoBot',
      'You are a terse assistant. Answer in at most one short sentence.',
    );

    await page.getByRole('button', { name: 'New Conversation' }).first().click();
    await expect(page.getByText('No messages yet')).toBeVisible();

    const input = page.getByPlaceholder('Type a message... (Shift+Enter for new line)');
    const secretWord = 'pineapple';

    // Turn 1: plant a distinctive word the agent must remember.
    await input.fill(`Remember this secret word: ${secretWord}. Say only: ok`);
    await input.press('Enter');
    await waitForAgentResponse(page);

    // Turn 2: the only way to answer correctly is to recall turn 1.
    await input.fill('What was the secret word I asked you to remember? Reply with only that word.');
    await input.press('Enter');

    // The second response bubble must be the LAST .markdown-body element and
    // must contain the secret word — proving history was loaded.
    const secondBubble = page.locator('.markdown-body').last();
    await expect(secondBubble).toBeVisible({ timeout: 120_000 });
    await expect(secondBubble).toContainText(new RegExp(secretWord, 'i'));
  });

  // @Name targeting: with two enabled personas, a mention must restrict the
  // reply to the mentioned persona only. The message-row author name is an
  // exact-text span, while the sidebar button is "🤖 AlphaBot" (emoji + name),
  // so getByText(name, { exact: true }) matches ONLY a real agent reply.
  test('@mention: only the mentioned persona replies', async ({ page }) => {
    test.setTimeout(300_000);

    await createPersona(page, 'AlphaBot', 'You are a terse assistant. Answer in one short word.');
    await createPersona(page, 'BetaBot', 'You are a terse assistant. Answer in one short word.');

    await page.getByRole('button', { name: 'New Conversation' }).first().click();
    await expect(page.getByText('No messages yet')).toBeVisible();

    const input = page.getByPlaceholder('Type a message... (Shift+Enter for new line)');
    await input.fill('@AlphaBot Reply with the single word: zebra');
    await input.press('Enter');

    // AlphaBot's streamed response arrives.
    const bubbles = page.locator('.markdown-body');
    await expect(bubbles.first()).toBeVisible({ timeout: 120_000 });

    // Wait until every stream finishes (the Stop generating button is only
    // visible while at least one agent is streaming). If the mention filter
    // were broken, BetaBot would also be streaming here.
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({
      timeout: 120_000,
    });

    // Give any hypothetical second stream a moment to materialize, then assert
    // exactly one response was produced — by AlphaBot, not BetaBot.
    await page.waitForTimeout(3000);
    await expect(bubbles).toHaveCount(1);

    // The message-row author name is a purple span (MessageBubble); the
    // sidebar button has its own "🤖 AlphaBot" label with an inner truncated
    // span, so scope to the message-row span via its distinctive classes.
    const messageAuthor = page.locator('span.font-medium.text-purple-700');
    await expect(messageAuthor).toHaveCount(1);
    await expect(messageAuthor).toHaveText('AlphaBot');
  });

  // Regenerate: the backend deletes the old agent message before streaming a
  // fresh one, so the deterministic UI proof is the bubble-count transition —
  // response appears (1), old bubble is removed on regenerate (0), then a new
  // streamed bubble replaces it (1) with a freshly rendered timestamp.
  test('regenerate: replaces the old response with a fresh one', async ({ page }) => {
    test.setTimeout(240_000);

    await createPersona(
      page,
      'RegenBot',
      'You are a terse assistant. Answer in at most one short sentence.',
    );

    await page.getByRole('button', { name: 'New Conversation' }).first().click();
    await expect(page.getByText('No messages yet')).toBeVisible();

    const input = page.getByPlaceholder('Type a message... (Shift+Enter for new line)');
    // The suite shares one profile, so earlier tests' personas are all enabled
    // and a bare message would trigger every one of them. @mention restricts
    // the reply to RegenBot only, keeping the bubble count deterministic.
    await input.fill('@RegenBot Reply with the word pong and nothing else.');
    await input.press('Enter');

    // First streamed response arrives — exactly one, from RegenBot.
    await waitForAgentResponse(page);
    const bubbles = page.locator('.markdown-body');
    await expect(bubbles).toHaveCount(1);

    // Message timestamps are the trailing gray span in the bubble header.
    const timeSpan = page.locator('span.text-gray-400').last();
    const firstTime = (await timeSpan.textContent())?.trim() ?? '';
    expect(firstTime).toMatch(/\d{1,2}:\d{2}\s[AP]M/);

    // Reveal the action buttons (opacity-0 until group hover) and regenerate.
    await bubbles.last().hover();
    await page.getByTitle('Regenerate').click();

    // The old message is deleted first — the bubble must vanish entirely
    // before the new stream begins (content is empty while streaming, so
    // .markdown-body does not exist).
    await expect(bubbles).toHaveCount(0, { timeout: 30_000 });

    // The replacement stream completes and a fresh bubble appears.
    await waitForAgentResponse(page);
    await expect(bubbles).toHaveCount(1);

    // The new message renders a timestamp of its own.
    const newTime = (await timeSpan.textContent())?.trim() ?? '';
    expect(newTime).toMatch(/\d{1,2}:\d{2}\s[AP]M/);
  });
});
