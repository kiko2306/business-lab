import { en } from './en';
import { ptPT } from './pt-pt';

// plan.md §790/§791/§794: found live during an audit — this page told a
// non-technical owner to "pull the latest code from main", "recreate every
// managed app on its pinned images", and showed raw commit hashes and a
// "commit(s) behind" count. §791 fixed the title/subtitle only and deferred
// the rest (a real design pass, not a wording swap); §794 finished it — the
// commit-hash rows are gone and every progress/confirm string is rewritten,
// so the guard now covers the whole namespace instead of three keys.
describe('Updates page strings', () => {
  const enJargon = /\bstack\b|\bpull\b|\bpinned\b|\brecreate\b|\bbranch\b|\bcommit\b|\bfrontend\b|\bbackend\b/i;
  const ptJargon = /\bpilha\b|\bramo\b|\bfixad[ao]s?\b|\brecria\b|\bcommit\b|\bfrontend\b|\bbackend\b/i;

  it('keeps git/deploy jargon out of every selfUpdate.* string', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('selfUpdate.'))) {
      expect(en[key]).withContext(`en ${key}`).not.toMatch(enJargon);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(ptJargon);
    }
  });

  it('no longer has a key for the removed commit-hash rows', () => {
    for (const key of ['selfUpdate.currentCommit', 'selfUpdate.latestOn']) {
      expect(en[key]).withContext(`en ${key}`).toBeUndefined();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeUndefined();
    }
  });

  it('has a translated updates-available count in both languages, singular and plural', () => {
    for (const key of ['selfUpdate.updatesAvailable.one', 'selfUpdate.updatesAvailable.other']) {
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
    expect(en['selfUpdate.updatesAvailable.other']).toContain('{{count}}');
  });
});
