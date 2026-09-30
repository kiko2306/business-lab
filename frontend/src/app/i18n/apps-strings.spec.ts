import { CATEGORY_DISPLAY_ORDER } from '../pages/apps/apps.component';
import { humanizeEnvKey } from '../components/service-card/service-card.component';
import { en } from './en';
import { ptPT } from './pt-pt';

// Registry-wide guard (plan.md §761): every category the Apps page can group
// by, and every access badge / boolean label, must be translated in both
// dictionaries — otherwise a pt-PT owner sees raw English or `lanOnly`.
describe('Apps page strings', () => {
  const keys = [
    ...CATEGORY_DISPLAY_ORDER.map((c) => `apps.category.${c}`),
    'serviceCard.access.lanOnly',
    'serviceCard.access.overlayOnly',
    'serviceCard.boolean.true',
    'serviceCard.boolean.false',
  ];

  it('has every key in en and pt-PT', () => {
    for (const key of keys) {
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
  });

  it('humanizes env keys into plain labels', () => {
    expect(humanizeEnvKey('SIGNUPS_ALLOWED')).toBe('Signups allowed');
    expect(humanizeEnvKey('NTFY_BEHIND_PROXY')).toBe('Ntfy behind proxy');
  });
});
