import { en } from './en';
import { ptPT } from './pt-pt';

// plan.md §790/§791, carried to the Home and Settings strings by §841: found live during an audit — "Stack health checks" and
// "Docker storage" leaked implementation vocabulary to a non-technical owner.
describe('Server health and network scan strings', () => {
  const enJargon = /\bstack\b|\bdocker\b/i;
  const ptJargon = /\bpilha\b|\bdocker\b/i;

  it('keeps stack/Docker wording out of every home.health.* and settings.networkScan.* string', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('home.health.') || k.startsWith('settings.networkScan.'))) {
      expect(en[key]).withContext(`en ${key}`).not.toMatch(enJargon);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(ptJargon);
    }
  });

  it('has no leftover Utils strings', () => {
    expect(Object.keys(en).filter((k) => k.startsWith('utils.'))).toEqual([]);
    expect(Object.keys(ptPT).filter((k) => k.startsWith('utils.'))).toEqual([]);
  });
});
