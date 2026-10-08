import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./status', () => ({ getAllServiceStatus: vi.fn() }));

import { ServiceStatusResponse } from '../types';
import {
  addStatusSubscriber,
  broadcastStatusTick,
  createStreamTicket,
  removeStatusSubscriber,
  resolveStreamTicketUser,
} from './realtime';

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

// plan.md §879 item 2. A stream ticket is an auth credential — 60 s, and it
// opens the live status stream — and it was minted from Date.now() plus
// Math.random().toString(36). Math.random() is not a CSPRNG: V8's generator
// state is recoverable from a handful of outputs, so watching one ticket
// predicts the next.
describe('createStreamTicket', () => {
  it('resolves to the user it was minted for, and only that', () => {
    const ticket = createStreamTicket(42);
    expect(resolveStreamTicketUser(ticket)).toBe(42);
    expect(resolveStreamTicketUser('not-a-ticket')).toBeNull();
    expect(resolveStreamTicketUser(null)).toBeNull();
    expect(resolveStreamTicketUser('')).toBeNull();
  });

  it('carries at least 122 bits of randomness and no timestamp', () => {
    const ticket = createStreamTicket(1);
    // A v4 UUID: 8-4-4-4-12 hex with the version and variant nibbles fixed.
    expect(ticket).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // The old shape led with Date.now().toString(36), which both shrank the
    // guessing space and leaked when the ticket was issued.
    expect(ticket.startsWith(Date.now().toString(36).slice(0, 6))).toBe(false);
  });

  it('never repeats across a burst', () => {
    const tickets = new Set(Array.from({ length: 500 }, () => createStreamTicket(1)));
    expect(tickets.size).toBe(500);
  });
});
