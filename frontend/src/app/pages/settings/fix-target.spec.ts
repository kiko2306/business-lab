import { fixTarget } from './fix-target';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';

// Plan.md §780: the provisioning checklist said "set it in <em>Networking</em>"
// as plain text, so a first-timer had to map a name to a panel. Every `fixIn`
// the backend emits (deploymentStatus.ts) must resolve to somewhere to go.
describe('fixTarget', () => {
  it('sends Networking and Email to a panel on this page', () => {
    expect(fixTarget('Networking')).toEqual(jasmine.objectContaining({ panelKey: 'settings:cloudflare', anchor: 'cloudflare' }));
    expect(fixTarget('Email')).toEqual(jasmine.objectContaining({ panelKey: 'settings:email', anchor: 'email' }));
  });

  it('sends Backup destination and Users page to their own routes', () => {
    expect(fixTarget('Backup destination')?.route).toBe('/backups');
    expect(fixTarget('Users page')?.route).toBe('/users');
  });

  it('has a translated label for every target, and null for an unknown name', () => {
    for (const name of ['Networking', 'Email', 'Backup destination', 'Users page']) {
      const key = fixTarget(name)!.labelKey;
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
    expect(fixTarget('Something else')).toBeNull();
  });
});

describe('Settings page strings', () => {
  // Reseller and developer wording shown to the client who owns the box, plus
  // (plan.md §787) telling them to run a shell command or open a guest-only
  // route the checklist itself already links them to.
  const enJargon = /docker|plan\.md|§|stack|reseller|contracted|self-controlled|bridge|start\.sh|\/setup/i;
  const ptJargon = /docker|plan\.md|§|revendedor|contratada|autogerida|bridge|start\.sh|\/setup/i;

  it('keeps developer and reseller wording out of settings.* and networkSettings.*', () => {
    for (const key of Object.keys(en).filter((k) => /^(settings|networkSettings)\./.test(k))) {
      expect(en[key]).withContext(`en ${key}`).not.toMatch(enJargon);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(ptJargon);
    }
  });

  it('does not promise a backups panel the page does not have', () => {
    expect(en['settings.subtitle']).not.toMatch(/backup/i);
    expect(ptPT['settings.subtitle']).not.toMatch(/c[óo]pias/i);
  });
});
