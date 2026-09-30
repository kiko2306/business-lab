import { en } from './en';
import { ptPT } from './pt-pt';

// plan.md §790/§791: found live during an audit — the title/subtitle told a
// non-technical owner to "pull the latest code from main" and "recreate
// every managed app on its pinned images". Only the title/subtitle were in
// scope for this pass; the commit-hash detail block below them (§791) is a
// separate, larger rewrite and stays as-is for now.
describe('Updates page top-level strings', () => {
  const enJargon = /\bstack\b|\bpull\b|\bpinned\b|\brecreate\b|\bbranch\b|\bcommit\b/i;
  const ptJargon = /\bpilha\b|\bramo\b|\bfixad[ao]s?\b|\brecria\b|\bcommit\b/i;

  it('keeps git/deploy jargon out of the page title and both subtitles', () => {
    for (const key of ['selfUpdate.title', 'selfUpdate.subtitle', 'selfUpdate.panel.subtitle']) {
      expect(en[key]).withContext(`en ${key}`).not.toMatch(enJargon);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(ptJargon);
    }
  });
});
