import { describe, expect, it, vi } from 'vitest';
import { getService } from '../config/services';
import {
  POST_UP_RECONCILERS,
  describeUpdate,
  parseComposeImages,
  runPostUpReconcilers,
  servicesWithBuild,
} from './executor';

vi.mock('../utils/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('describeUpdate', () => {
  // The message is the only feedback an update gives when nothing goes wrong,
  // so "nothing changed" has to be distinguishable from "it worked".
  it('says so plainly when the pull changed nothing', () => {
    expect(describeUpdate([])).toBe('Already on the latest images.');
  });

  it('names the single image that changed', () => {
    expect(describeUpdate(['mealie/mealie:latest'])).toBe('Updated 1 image: mealie/mealie:latest');
  });

  it('names every image when a multi-container app moves', () => {
    expect(describeUpdate(['immich/server:latest', 'redis:7'])).toBe(
      'Updated 2 images: immich/server:latest, redis:7'
    );
  });

  it('does not claim nothing changed when the image IDs could not be read', () => {
    expect(describeUpdate(null)).toBe('Pulled and recreated. Could not tell which images changed.');
  });
});

describe('parseComposeImages', () => {
  const row = (container: string, id: string, repository = 'x') =>
    ({ ContainerName: container, ID: id, Repository: repository, Tag: 'latest' });

  it('maps each container to its image ID and a readable image name', () => {
    const map = parseComposeImages(
      JSON.stringify([row('immich-server-1', 'sha256:aaa', 'immich/server'), row('immich-redis-1', 'sha256:bbb', 'redis')])
    );
    expect(map?.get('immich-server-1')).toEqual({ id: 'sha256:aaa', name: 'immich/server:latest' });
    expect(map?.get('immich-redis-1')).toEqual({ id: 'sha256:bbb', name: 'redis:latest' });
  });

  it('returns null for output that is not the expected array', () => {
    // Compose printing an error, or a version that does not support
    // --format json, must not read as "no images, so nothing changed".
    expect(parseComposeImages('no such service')).toBeNull();
    expect(parseComposeImages('{}')).toBeNull();
    expect(parseComposeImages('[]')).toBeNull();
  });
});


describe('servicesWithBuild', () => {
  // The update path rebuilds only when this is non-empty, so a miss here means
  // an app's new code is deployed but never built.
  it('finds the services that build from source and not the stock images', () => {
    const config = JSON.stringify({
      services: {
        tally: { build: { context: '.' } },
        'tally-db': { image: 'postgres:17-alpine' },
      },
    });
    expect(servicesWithBuild(config)).toEqual(['tally']);
  });

  it('is empty for an app with only pulled images, and for unreadable output', () => {
    expect(servicesWithBuild(JSON.stringify({ services: { a: { image: 'x' } } }))).toEqual([]);
    expect(servicesWithBuild('not json')).toEqual([]);
  });
});

describe('runPostUpReconcilers', () => {
  // Regression: these used to be ~27 bare `await`s in composeUpWithManagedConfig.
  // By the time they run `docker compose up` has already succeeded and the
  // container is up, so one of them throwing unwound into startService's
  // catch and answered 500 "Failed to start" for an app that was running —
  // and skipped exposure provisioning and the Home Page regeneration with it,
  // leaving the app up with no NPM host, no tunnel route and no tile.
  it('runs every reconciler even when one throws, and does not rethrow', async () => {
    const calls: string[] = [];
    const ok = async (name: string) => void calls.push(`first:${name}`);
    const boom = async () => {
      throw new Error('reconciler exploded');
    };
    const after = async (name: string) => void calls.push(`third:${name}`);

    await expect(runPostUpReconcilers('paperless', { paperless: [ok, boom, after] })).resolves.toBeUndefined();

    expect(calls).toEqual(['first:paperless', 'third:paperless']);
  });

  it('runs them in order', async () => {
    const order: number[] = [];
    const step = (n: number) => async () => void order.push(n);

    await runPostUpReconcilers('itflow', { itflow: [step(1), step(2), step(3)] });

    expect(order).toEqual([1, 2, 3]);
  });

  // plan.md §901: every start used to walk all 27 entries, each returning on a name
  // check. Now a start runs only the entries registered under its own name.
  it("runs only the started service's reconcilers", async () => {
    const calls: string[] = [];
    const record = (label: string) => async (name: string) => void calls.push(`${label}:${name}`);

    await runPostUpReconcilers('immich', { immich: [record('a')], nextcloud: [record('b'), record('c')] });

    expect(calls).toEqual(['a:immich']);
  });

  it('does nothing for a service with no reconcilers', async () => {
    const reconciler = vi.fn();
    await expect(runPostUpReconcilers('whoami', { immich: [reconciler] })).resolves.toBeUndefined();
    expect(reconciler).not.toHaveBeenCalled();
  });
});

describe('POST_UP_RECONCILERS', () => {
  it('is keyed by real registry services', () => {
    for (const name of Object.keys(POST_UP_RECONCILERS)) {
      expect(getService(name), name).toBeDefined();
    }
  });

  // The old flat list had 28 entries; losing one in the regrouping would silently
  // stop an app's first-admin bootstrap.
  it('still holds all 28 reconcilers, none twice', () => {
    const all = Object.values(POST_UP_RECONCILERS).flat();
    expect(all).toHaveLength(28);
    expect(new Set(all).size).toBe(28);
  });

  // The ordering constraints from the old list's doc comment, now within one service.
  it('keeps the ordering constraints inside a service', () => {
    const names = (service: string) => POST_UP_RECONCILERS[service].map((fn) => fn.name);
    const itflow = names('itflow');
    expect(itflow.indexOf('reconcileItflowFirstAdmin')).toBeLessThan(itflow.indexOf('reconcileItflowMailCron'));
    expect(itflow.indexOf('reconcileItflowFirstAdmin')).toBeLessThan(itflow.indexOf('reconcileItflowBillingModule'));
    const kuma = names('uptime-kuma');
    expect(kuma.indexOf('reconcileUptimeKumaFirstAdmin')).toBeLessThan(
      kuma.indexOf('reconcileUptimeKumaMailNotification')
    );
  });
});
