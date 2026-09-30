import { en } from './en';
import { ptPT } from './pt-pt';

// plan.md §790/§791: found live during an audit — "Stack health checks" and
// "Docker storage" leaked implementation vocabulary to a non-technical owner.
describe('Utils page strings', () => {
  const enJargon = /\bstack\b|\bdocker\b/i;
  const ptJargon = /\bpilha\b|\bdocker\b/i;

  it('keeps stack/Docker wording out of every utils.* string', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('utils.'))) {
      expect(en[key]).withContext(`en ${key}`).not.toMatch(enJargon);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(ptJargon);
    }
  });
});
