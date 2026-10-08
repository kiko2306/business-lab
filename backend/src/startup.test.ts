import { describe, expect, it, vi } from 'vitest';
import { ensureSchema, SchemaStep } from './startup';

// plan.md §884 item 3. index.ts fired about a dozen ensure* chains unawaited and
// called app.listen on the next line, so on a first boot or an upgrade a request
// could arrive before its table existed. The schema now gates listening; the
// sweepers and reconcilers still start after it, because they are long-running
// and must not hold up readiness.
describe('ensureSchema', () => {
  const step = (label: string, run: () => Promise<unknown>): SchemaStep => ({ label, run });

  it('does not resolve until every step has settled', async () => {
    const order: string[] = [];
    const slow = step('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('slow');
    });
    const quick = step('quick', async () => {
      order.push('quick');
    });

    await ensureSchema([slow, quick]);
    order.push('listen');
    expect(order).toEqual(['quick', 'slow', 'listen']);
  });

  it('runs the steps concurrently, not one after another', async () => {
    const started: number[] = [];
    const steps = [1, 2, 3].map((n) =>
      step(`step ${n}`, async () => {
        started.push(n);
        await new Promise((resolve) => setTimeout(resolve, 20));
      })
    );

    const begun = Date.now();
    await ensureSchema(steps);
    // Three 20ms steps in sequence would be 60ms; concurrently it is one 20ms.
    expect(Date.now() - begun).toBeLessThan(55);
    expect(started).toEqual([1, 2, 3]);
  });

  it('still resolves when a step throws, and says which one', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ran: string[] = [];
    const steps = [
      step('ensure the widget table', async () => {
        throw new Error('relation "widget" does not exist');
      }),
      step('ensure the gadget table', async () => {
        ran.push('gadget');
      }),
    ];

    // One broken migration must not keep the API from ever answering, and must
    // not stop a later one running — they touch different tables.
    await expect(ensureSchema(steps)).resolves.toBeUndefined();
    expect(ran).toEqual(['gadget']);
    expect(logged.mock.calls.flat().join(' ')).toContain('ensure the widget table');
    expect(logged.mock.calls.flat().join(' ')).toContain('relation "widget" does not exist');
    logged.mockRestore();
  });
});
