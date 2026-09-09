import { describe, it, expect } from 'vitest';
import { selectOrphanAppDirs } from './removedAppCleanup';

const entry = (name: string, over: Partial<{ isDirectory: boolean; hasCompose: boolean }> = {}) => ({
  name,
  isDirectory: over.isDirectory ?? true,
  hasCompose: over.hasCompose ?? false,
});

describe('selectOrphanAppDirs', () => {
  // forgejo is the removed app — deliberately not in the registry.
  const registry = new Set(['navidrome', 'home-page']);

  it('picks a dir with no registry entry and no compose file', () => {
    expect(selectOrphanAppDirs([entry('forgejo')], registry)).toEqual(['forgejo']);
  });

  it('keeps a still-registered app even with no compose file on disk', () => {
    expect(selectOrphanAppDirs([entry('navidrome')], registry)).toEqual([]);
  });

  it('leaves an unregistered dir alone while it still has a compose file (mid-edit / new scaffold)', () => {
    expect(selectOrphanAppDirs([entry('half-built', { hasCompose: true })], registry)).toEqual([]);
  });

  it('ignores plain files under apps/', () => {
    expect(selectOrphanAppDirs([entry('README.md', { isDirectory: false, hasCompose: true })], registry)).toEqual([]);
  });

  it('rejects names that are not compose-project-shaped', () => {
    for (const bad of ['.git', '..', 'Weird_Name', 'a/b']) {
      expect(selectOrphanAppDirs([entry(bad)], registry)).toEqual([]);
    }
  });

  it('refuses to act when the registry is empty (failed load looks like "all removed")', () => {
    expect(selectOrphanAppDirs([entry('forgejo'), entry('navidrome')], new Set())).toEqual([]);
  });
});
