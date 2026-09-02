import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parseAuthChallenge, parseImageRef, pickLocalDigest } from './imageUpdates';

describe('parseImageRef', () => {
  it('sends a bare name to Docker Hub under library/', () => {
    expect(parseImageRef('nginx:alpine')).toEqual({
      registry: 'registry-1.docker.io',
      repository: 'library/nginx',
      reference: 'alpine',
      pinned: false,
    });
  });

  it('defaults the tag to latest', () => {
    expect(parseImageRef('postgres')?.reference).toBe('latest');
  });

  it('keeps a Docker Hub org name as-is', () => {
    expect(parseImageRef('immich/server:v1.2')).toMatchObject({
      registry: 'registry-1.docker.io',
      repository: 'immich/server',
      reference: 'v1.2',
    });
  });

  it('treats a first component with a dot as a registry host', () => {
    expect(parseImageRef('lscr.io/linuxserver/speedtest-tracker:latest')).toMatchObject({
      registry: 'lscr.io',
      repository: 'linuxserver/speedtest-tracker',
    });
  });

  it('treats a registry port as a host, not a tag', () => {
    // The colon is before the last slash, so it cannot be the tag.
    expect(parseImageRef('localhost:5000/team/app')).toMatchObject({
      registry: 'localhost:5000',
      repository: 'team/app',
      reference: 'latest',
    });
  });

  it('marks a digest-pinned ref as pinned, since it cannot go out of date', () => {
    expect(parseImageRef('nginx@sha256:abc')?.pinned).toBe(true);
  });

  it('rejects nonsense rather than guessing', () => {
    expect(parseImageRef('')).toBeNull();
    expect(parseImageRef('two words')).toBeNull();
  });
});

describe('parseAuthChallenge', () => {
  it('reads realm, service and scope from a Docker Hub challenge', () => {
    const parsed = parseAuthChallenge(
      'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"'
    );
    expect(parsed?.realm).toBe('https://auth.docker.io/token');
    expect(parsed?.params).toEqual({
      service: 'registry.docker.io',
      scope: 'repository:library/nginx:pull',
    });
  });

  it('returns null without a realm, which is the one part we cannot invent', () => {
    expect(parseAuthChallenge('Bearer service="x"')).toBeNull();
    expect(parseAuthChallenge('Basic realm="x"')).toBeNull();
  });
});

describe('pickLocalDigest', () => {
  it('matches the entry for the repository being checked', () => {
    const digests = ['nginx@sha256:aaa', 'other@sha256:bbb'];
    expect(pickLocalDigest(digests, 'library/nginx')).toBe('sha256:aaa');
  });

  it('matches a registry-qualified entry', () => {
    expect(pickLocalDigest(['lscr.io/linuxserver/grocy@sha256:ccc'], 'linuxserver/grocy')).toBe('sha256:ccc');
  });

  it('falls back to a lone entry whose name does not match', () => {
    expect(pickLocalDigest(['weird@sha256:ddd'], 'something/else')).toBe('sha256:ddd');
  });

  it('returns null for a locally built image, which has no digests at all', () => {
    expect(pickLocalDigest([], 'homelab-backend')).toBeNull();
  });
});
