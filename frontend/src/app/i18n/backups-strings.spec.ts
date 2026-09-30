import { en } from './en';
import { ptPT } from './pt-pt';

// Plan.md §776: the Backups page is read by a business owner, so the two lists
// say what they hold and no tool names (Kopia, rclone, "repository") leak into
// the copy. The old headings "Settings Backups" / "Full Backups" did not say
// which one restores what. Flag names like --disable-tls stay: the user types them.
describe('Backups page strings', () => {
  const enJargon = /kopia|rclone|repository|snapshot/i;
  const ptJargon = /kopia|rclone|repository|captura/i;

  it('keeps tool names out of every user-facing backups string', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('backups.'))) {
      // Internal-only wording that is not shown as a sentence.
      expect(en[key]).withContext(`en ${key}`).not.toMatch(enJargon);
      expect(ptPT[key]).withContext(`pt-PT ${key}`).not.toMatch(ptJargon);
    }
  });

  it('names the two lists by what they hold, and explains each', () => {
    expect(en['backups.settingsBackups.heading']).toBe('Saved settings files');
    expect(en['backups.fullBackups.heading']).toBe('App data backups');
    expect(en['backups.settingsButton']).toBe('Save settings file');
    for (const key of ['backups.settingsBackups.description', 'backups.fullBackups.description']) {
      expect(en[key]).withContext(`en ${key}`).toBeTruthy();
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
  });
});
