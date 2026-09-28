import { describe, expect, it } from 'vitest';
import { pollUntilReady, sleep } from './wait';

describe('pollUntilReady', () => {
  it('probes once when the first result is already ready', async () => {
    let calls = 0;
    const result = await pollUntilReady(
      async () => {
        calls += 1;
        return 'ready';
      },
      (r) => r === 'ready',
      5,
      0
    );

    expect(result).toBe('ready');
    expect(calls).toBe(1);
  });

  it('keeps probing until ready and returns that result', async () => {
    let calls = 0;
    const result = await pollUntilReady(
      async () => {
        calls += 1;
        return calls < 3 ? 'unreachable' : 'needs-admin';
      },
      (r) => r !== 'unreachable',
      5,
      0
    );

    expect(result).toBe('needs-admin');
    expect(calls).toBe(3);
  });

  // `attempts` counts probes, not retries — the hand-written loops this
  // replaces probed MAX_ATTEMPTS times with MAX_ATTEMPTS - 1 sleeps between.
  it('gives up after exactly `attempts` probes and returns the last result', async () => {
    let calls = 0;
    const result = await pollUntilReady(
      async () => {
        calls += 1;
        return 'unreachable';
      },
      (r) => r !== 'unreachable',
      4,
      0
    );

    expect(result).toBe('unreachable');
    expect(calls).toBe(4);
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    const before = Date.now();
    await sleep(20);
    expect(Date.now() - before).toBeGreaterThanOrEqual(15);
  });
});
