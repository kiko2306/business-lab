import { describe, it, expect } from 'vitest';
import { selectOrphanAppDirs } from './removedAppCleanup';

const entry = (name: string, over: Partial<{ isDirectory: boolean; hasCompose: boolean }> = {}) => ({
  name,
  isDirectory: over.isDirectory ?? true,
  hasCompose: over.hasCompose ?? false,
});

describe('selectOrphanAppDirs', () => {
  // The set is known project *directory* names, not registry keys. forgejo is
  // the removed app — deliberately absent.
  const knownDirs = new Set(['navidrome', 'home-page']);

  it('picks a dir that is not a known project and has no compose file', () => {
    expect(selectOrphanAppDirs([entry('forgejo')], knownDirs)).toEqual(['forgejo']);
  });

  it('keeps a known project dir even with no compose file on disk', () => {
    expect(selectOrphanAppDirs([entry('navidrome')], knownDirs)).toEqual([]);
  });

  it('keeps a dir whose name differs from its registry key (home-page vs homepage)', () => {
    // `getProjectName('homepage')` resolves to 'home-page' for the caller, so
    // the set contains the dir name — this must not be treated as an orphan.
    expect(selectOrphanAppDirs([entry('home-page')], knownDirs)).toEqual([]);
  });

  it('leaves an unknown dir alone while it still has a compose file (mid-edit / new scaffold)', () => {
    expect(selectOrphanAppDirs([entry('half-built', { hasCompose: true })], knownDirs)).toEqual([]);
  });

  it('ignores plain files under apps/', () => {
    expect(selectOrphanAppDirs([entry('README.md', { isDirectory: false, hasCompose: true })], knownDirs)).toEqual([]);
  });

  it('rejects names that are not compose-project-shaped', () => {
    for (const bad of ['.git', '..', 'Weird_Name', 'a/b']) {
      expect(selectOrphanAppDirs([entry(bad)], knownDirs)).toEqual([]);
    }
  });

  it('refuses to act when the known set is empty (failed registry load looks like "all removed")', () => {
    expect(selectOrphanAppDirs([entry('forgejo'), entry('navidrome')], new Set())).toEqual([]);
  });
});
