import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./status', () => ({ getAllServiceStatus: vi.fn() }));

import { ServiceStatusResponse } from '../types';
import { addStatusSubscriber, broadcastStatusTick, removeStatusSubscriber } from './realtime';

const payload = { services: [] } as unknown as ServiceStatusResponse;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('broadcastStatusTick', () => {
  it('builds the payload once for however many subscribers are listening', async () => {
    // The point of the shared tick: each SSE client used to run its own
    // interval and its own full status build (~50 docker/db lookups), so three
    // open tabs cost three times as much as one.
    const build = vi.fn(async () => payload);
    const received: ServiceStatusResponse[] = [];
    const subscribers = [0, 1, 2].map(() => (p: ServiceStatusResponse) => received.push(p));
    subscribers.forEach(addStatusSubscriber);

    try {
      await broadcastStatusTick(build);
      expect(build).toHaveBeenCalledTimes(1);
      expect(received).toEqual([payload, payload, payload]);
    } finally {
      subscribers.forEach(removeStatusSubscriber);
    }
  });

  it('does not build a payload with nobody listening', async () => {
    const build = vi.fn(async () => payload);
    await broadcastStatusTick(build);
    expect(build).not.toHaveBeenCalled();
  });

  it('still reaches the other subscribers when one throws', async () => {
    // A socket that died between the build and the write must not cost the
    // rest of the clients their update.
    const received: string[] = [];
    const bad = () => {
      throw new Error('socket gone');
    };
    const good = () => received.push('ok');
    addStatusSubscriber(bad);
    addStatusSubscriber(good);

    try {
      await broadcastStatusTick(async () => payload);
      expect(received).toEqual(['ok']);
    } finally {
      removeStatusSubscriber(bad);
      removeStatusSubscriber(good);
    }
  });

  it('swallows a failed status build so the stream survives the cycle', async () => {
    const good = vi.fn();
    addStatusSubscriber(good);
    try {
      await expect(
        broadcastStatusTick(async () => {
          throw new Error('docker unreachable');
        })
      ).resolves.toBeUndefined();
      expect(good).not.toHaveBeenCalled();
    } finally {
      removeStatusSubscriber(good);
    }
  });
});
