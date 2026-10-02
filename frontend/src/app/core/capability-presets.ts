import { ALL_CAPABILITIES, Capability } from './capabilities';

export type PresetId = 'everything' | 'dayToDay' | 'viewOnly';

export interface CapabilityPreset {
  id: PresetId;
  capabilities: Capability[];
}

/**
 * Named starting points for an admin's features (plan.md §826): eight raw
 * names were the only way to say what someone may do. A preset only ticks the
 * boxes; they stay editable, and nothing here is stored, so a saved set is
 * recognised as a preset by what it contains, not by a label.
 */
export const CAPABILITY_PRESETS: CapabilityPreset[] = [
  { id: 'everything', capabilities: [...ALL_CAPABILITIES] },
  { id: 'dayToDay', capabilities: ['apps:control', 'backups:manage', 'audit:view'] },
  { id: 'viewOnly', capabilities: ['audit:view'] },
];

export function presetFor(capabilities: Capability[]): PresetId | 'custom' {
  const have = [...capabilities].sort().join(',');
  return CAPABILITY_PRESETS.find((p) => [...p.capabilities].sort().join(',') === have)?.id ?? 'custom';
}
