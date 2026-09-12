import { describe, expect, it } from 'vitest';
import { readSetupState } from './jellyfinAdminBootstrap';

describe('readSetupState', () => {
  // The live shape of GET /System/Info/Public on a fresh Jellyfin.
  it('reads StartupWizardCompleted: false as "needs wizard"', () => {
    expect(readSetupState({ ServerName: '', Version: '12.0.0', StartupWizardCompleted: false })).toBe(
      'needs-wizard'
    );
  });

  it('reads a completed wizard as already set up', () => {
    expect(readSetupState({ StartupWizardCompleted: true })).toBe('already-setup');
  });

  // Fails closed: re-running the wizard against a live server is the damaging
  // direction, so anything unrecognised must read as already set up.
  it('treats a missing or unrecognised shape as already set up, never as needs-wizard', () => {
    expect(readSetupState({})).toBe('already-setup');
    expect(readSetupState(null)).toBe('already-setup');
    expect(readSetupState({ StartupWizardCompleted: 'false' })).toBe('already-setup');
    expect(readSetupState({ StartupWizardComplete: false })).toBe('already-setup');
  });
});
