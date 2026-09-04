import { describe, it, expect } from 'vitest';
import { withMaintenanceLock } from './maintenanceLock';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withMaintenanceLock', () => {
  it('runs queued holders one at a time, in order', async () => {
    const order: string[] = [];

    const a = withMaintenanceLock('a', async () => {
      order.push('a:start');
      await tick(30);
      order.push('a:end');
    });
    // Queued while `a` is still running — must not start until `a` finishes.
    const b = withMaintenanceLock('b', async () => {
      order.push('b:start');
      await tick(5);
      order.push('b:end');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('surfaces the holder\'s result and rejection to its own caller', async () => {
    await expect(withMaintenanceLock('ok', async () => 42)).resolves.toBe(42);
    await expect(withMaintenanceLock('boom', async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
  });

  it('does not wedge the queue when a holder rejects', async () => {
    const failed = withMaintenanceLock('fails', async () => {
      throw new Error('first blew up');
    });
    await expect(failed).rejects.toThrow('first blew up');

    // The next holder still gets to run.
    await expect(withMaintenanceLock('after', async () => 'ran')).resolves.toBe('ran');
  });
});
