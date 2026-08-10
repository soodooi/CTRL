// Governed note write — real-path UI verification for U6.
//
// A note the session owns renders in the Work pane through the canonical
// descriptor projection. Editing it must go through `produce(replace_content)`
// with the revision the user actually saw, report saved ONLY on the kernel's
// post-write verification, and turn a moved revision into a typed conflict
// instead of overwriting someone else's change.
// (ADR-002 substrate §15.2 v87; ADR-003 frontend § decision-registry v43;
// ADR-005 irisy §12 v42 U6)

import { test, expect, type Page } from '@playwright/test';

const NOTE_REF = 'ctrl://local/note/Budget.md';

interface MockOptions {
  /** Revision the descriptor reports, i.e. what the editor stages against. */
  revision: string;
  /** When set, produce answers with a precondition failure using this operand. */
  conflictWith?: string;
  /** The model answers with nothing usable. */
  emptyRewrite?: boolean;
}

function installShellMock(page: Page, options: MockOptions): Promise<void> {
  return page.addInitScript(
    (opts) => {
      window.localStorage.clear();
      window.localStorage.setItem(
        'ctrl:irisy-sessions:v1',
        JSON.stringify({
          version: 2,
          state: {
            activeSessionId: 'e2e-session',
            sessions: [
              {
                id: 'e2e-session',
                label: 'Note',
                messages: [],
                createdAt: 1,
                lastActiveAt: 1,
                resources: [opts.ref],
              },
            ],
          },
        }),
      );

      const calls: unknown[] = [];
      (window as unknown as { __produceCalls: unknown[] }).__produceCalls = calls;
      const installed: unknown[] = [];
      (window as unknown as { __installed: unknown[] }).__installed = installed;

      const harness = window as unknown as {
        __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      };
      harness.__ctrlInvokeMock = (command, args) => {
        if (command === 'gate_invoke') {
          const call = args as {
            tool?: string;
            args?: {
              ref?: string;
              request?: { operation?: string };
              operation?: { kind?: string; expected_revision?: string; content?: string };
            };
          };
          if (call.tool === 'describe' && call.args?.ref === opts.ref) {
            return {
              protocol_version: '1',
              resource: opts.ref,
              content_type: 'text/markdown',
              provenance: [],
              freshness: { revision: opts.revision, observed_at: null, stale: false },
              degradation: null,
              presentation: { viewer: 'markdown', title: 'Budget.md', preferred_columns: [] },
              produce: [{ kind: 'replace_content', review_required: true }],
            };
          }
          if (call.tool === 'query' && call.args?.ref === opts.ref) {
            return {
              resource: opts.ref,
              revision: opts.revision,
              content: '# Budget\n\nOriginal body.\n',
              content_type: 'text/markdown',
            };
          }
          if (call.tool === 'query' && call.args?.request?.operation === 'list') return [];
          // The markdown viewer resolves wikilinks against the vault listing.
          if (call.tool === 'vault_list') return [];
          if (call.tool === 'mcp_pack_install') {
            installed.push((args as { args?: { manifest?: unknown } }).args?.manifest);
            return null;
          }
          // One non-streaming governed completion; the proposal is staged, not applied.
          if (call.tool === 'llm_chat') {
            if (opts.emptyRewrite) return { content: '   ' };
            return { content: '```markdown\n# Budget\n\nTightened body.\n```' };
          }
          if (call.tool === 'produce') {
            calls.push(call.args?.operation);
            if (opts.conflictWith) {
              return {
                resource: opts.ref,
                feedback: {
                  code: 'precondition_failed',
                  message: 'the note changed since it was staged; nothing was written',
                  severity: 'error',
                  field: 'expected_revision',
                  retryable: true,
                  details: {
                    expected: call.args?.operation?.expected_revision,
                    actual: opts.conflictWith,
                  },
                },
              };
            }
            return {
              resource: opts.ref,
              target: 'Budget.md',
              effect: {
                summary: 'replaced the note content',
                verified_by: 'post-write reread matched the expected revision',
              },
              result: { revision: 'rev-after' },
            };
          }
          return null;
        }
        if (command === 'coding_launcher_status') {
          return {
            workspaces: [],
            terminals: [],
            editors: [],
            opencodeAvailable: false,
            launchCommand: null,
          };
        }
        if (command === 'list_mcps') return [];
        if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
        if (command === 'get_version') return 'e2e';
        return null;
      };
    },
    { ...options, ref: NOTE_REF },
  );
}

/** Type into the rendered markdown editor so the auto-save debounce fires. */
async function editNote(page: Page, text: string): Promise<void> {
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

test('a note save goes through produce with the staged revision and reports the kernel verification', async ({
  page,
}) => {
  await installShellMock(page, { revision: 'rev-seen' });
  await page.goto('/');

  // The note renders from its descriptor, and its content came through `query`.
  await expect(page.getByTestId('provenance-drilldown')).toContainText(NOTE_REF);
  await expect(page.locator('.ProseMirror').first()).toContainText('Original body.');

  await editNote(page, ' Added.');

  const verified = page.getByTestId('resource-save-verified');
  await expect(verified).toBeVisible();
  // The surface reports the kernel's own proof, not a generic "saved".
  await expect(verified).toContainText('post-write reread matched the expected revision');
  await expect(verified).toContainText('rev-after');

  // The write was conditioned on the revision the user actually saw.
  const calls = await page.evaluate(
    () => (window as unknown as { __produceCalls: { kind?: string; expected_revision?: string }[] })
      .__produceCalls,
  );
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[0]?.kind).toBe('replace_content');
  expect(calls[0]?.expected_revision).toBe('rev-seen');
});

test('a revision that moved raises a typed conflict instead of overwriting', async ({ page }) => {
  await installShellMock(page, { revision: 'rev-seen', conflictWith: 'rev-elsewhere' });
  await page.goto('/');

  await editNote(page, ' Added.');

  const conflict = page.locator('[data-decision-kind="conflict"]');
  await expect(conflict).toBeVisible();
  await expect(conflict).toHaveAttribute('data-decision-intent', 'U12');
  await expect(conflict).toContainText('This changed on disk, so nothing was written.');
  // Both revision operands are shown, so the user can see WHY it stopped.
  await expect(conflict).toContainText('rev-seen');
  await expect(conflict).toContainText('rev-elsewhere');
  // Nothing was claimed as saved.
  await expect(page.getByTestId('resource-save-verified')).toHaveCount(0);

  // Reviewing the current state clears the decision and reloads from disk.
  await conflict.getByRole('button', { name: 'Review current state' }).click();
  await expect(page.locator('[data-decision-kind="conflict"]')).toHaveCount(0);
});

test('a verified change offers reuse as an FCT, defaulting to not saving', async ({ page }) => {
  await installShellMock(page, { revision: 'rev-seen' });
  await page.goto('/');

  await editNote(page, ' Added.');
  await expect(page.getByTestId('resource-save-verified')).toBeVisible();

  // The offer is derived from the Outcome and says what it will NOT do.
  const capture = page.locator('[data-decision-kind="capture"]');
  await expect(capture).toBeVisible();
  await expect(capture).toHaveAttribute('data-decision-intent', 'U23');
  await expect(capture).toContainText('Save Budget as an FCT');
  await expect(capture).toContainText('the steps you just took');
  await expect(capture).toContainText('post-write reread matched the expected revision');

  await capture.getByRole('button', { name: 'Save as FCT' }).click();
  await expect(page.getByTestId('resource-capture-note')).toContainText(
    'Saved "Budget" to Installed FCTs. It was not activated.',
  );

  // The saved FCT is a selectable dependency, not an executable pack.
  const installed = await page.evaluate(
    () => (window as unknown as { __installed: Record<string, unknown>[] }).__installed,
  );
  expect(installed).toHaveLength(1);
  expect(installed[0]?.['resources']).toEqual(['ctrl://local/note/Budget.md']);
  expect(installed[0]?.['actions']).toEqual([]);
});

test('declining reuse saves nothing', async ({ page }) => {
  await installShellMock(page, { revision: 'rev-seen' });
  await page.goto('/');

  await editNote(page, ' Added.');
  const capture = page.locator('[data-decision-kind="capture"]');
  await capture.getByRole('button', { name: 'Not now' }).click();

  await expect(page.locator('[data-decision-kind="capture"]')).toHaveCount(0);
  await expect(page.getByTestId('resource-capture-note')).toHaveCount(0);
  const installed = await page.evaluate(
    () => (window as unknown as { __installed: unknown[] }).__installed,
  );
  expect(installed).toEqual([]);
});

test('a proposed rewrite is staged for decision and only writes when approved', async ({
  page,
}) => {
  await installShellMock(page, { revision: 'rev-seen' });
  await page.goto('/');
  await expect(page.locator('.ProseMirror').first()).toContainText('Original body.');

  await page.getByRole('button', { name: 'Rewrite' }).click();

  // The staged change shows the real document on both sides, and nothing is
  // written yet.
  const approval = page.locator('[data-decision-kind="approval"]');
  await expect(approval).toBeVisible();
  await expect(approval).toHaveAttribute('data-decision-intent', 'U2');
  await expect(approval).toContainText('Original body.');
  await expect(approval).toContainText('Tightened body.');
  await expect(approval).toContainText('the whole document');
  await expect(approval).toContainText('rev-seen');
  let produced = await page.evaluate(
    () => (window as unknown as { __produceCalls: unknown[] }).__produceCalls,
  );
  expect(produced).toEqual([]);

  // The approval kind is modal: its options live in the dialog footer, outside
  // the element carrying data-decision-kind.
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();

  // Approval goes through the SAME governed write: revision recheck, verified.
  await expect(page.getByTestId('resource-save-verified')).toBeVisible();
  produced = await page.evaluate(
    () => (window as unknown as { __produceCalls: { kind?: string; expected_revision?: string; content?: string }[] })
      .__produceCalls,
  );
  expect(produced).toHaveLength(1);
  expect(produced[0]).toMatchObject({
    kind: 'replace_content',
    expected_revision: 'rev-seen',
    content: '# Budget\n\nTightened body.\n',
  });
});

test('discarding a proposed rewrite writes nothing', async ({ page }) => {
  await installShellMock(page, { revision: 'rev-seen' });
  await page.goto('/');
  await expect(page.locator('.ProseMirror').first()).toContainText('Original body.');

  await page.getByRole('button', { name: 'Summarize' }).click();
  const approval = page.locator('[data-decision-kind="approval"]');
  await expect(approval).toContainText('Summarize Budget.md?');
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();

  await expect(page.locator('[data-decision-kind="approval"]')).toHaveCount(0);
  const produced = await page.evaluate(
    () => (window as unknown as { __produceCalls: unknown[] }).__produceCalls,
  );
  expect(produced).toEqual([]);
  await expect(page.getByTestId('resource-save-verified')).toHaveCount(0);
});

test('a model that returns nothing usable is reported, not applied', async ({ page }) => {
  await installShellMock(page, { revision: 'rev-seen', emptyRewrite: true });
  await page.goto('/');
  await expect(page.locator('.ProseMirror').first()).toContainText('Original body.');

  await page.getByRole('button', { name: 'Rewrite' }).click();

  await expect(page.locator('[data-decision-kind="approval"]')).toHaveCount(0);
  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await decision.getByText('View details').click();
  await expect(decision).toContainText('no replacement text');
  const produced = await page.evaluate(
    () => (window as unknown as { __produceCalls: unknown[] }).__produceCalls,
  );
  expect(produced).toEqual([]);
});
