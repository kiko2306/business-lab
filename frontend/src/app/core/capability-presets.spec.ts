import { ALL_CAPABILITIES } from './capabilities';
import { CAPABILITY_PRESETS, presetFor } from './capability-presets';

// plan.md §826: eight raw feature names were the only way to say what an
// admin may do. A preset is a named starting point; the boxes stay editable.
describe('capability presets', () => {
  it('only name real capabilities, and never an empty set (an admin needs one)', () => {
    for (const preset of CAPABILITY_PRESETS) {
      expect(preset.capabilities.length).toBeGreaterThan(0);
      for (const capability of preset.capabilities) {
        expect(ALL_CAPABILITIES).toContain(capability);
      }
    }
  });

  it('starts with Everything, which is every capability', () => {
    expect(CAPABILITY_PRESETS[0].id).toBe('everything');
    expect([...CAPABILITY_PRESETS[0].capabilities].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('recognises a preset whatever order the capabilities arrive in', () => {
    for (const preset of CAPABILITY_PRESETS) {
      expect(presetFor([...preset.capabilities].reverse())).toBe(preset.id);
    }
  });

  it('calls anything else custom', () => {
    expect(presetFor(['apps:config'])).toBe('custom');
    expect(presetFor([])).toBe('custom');
  });
});
