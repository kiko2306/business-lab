import { describe, expect, it } from 'vitest';
import { __test } from './npmSecurityHeaders';

const { buildHstsBlock, HSTS_MARKER_BEGIN, HSTS_MARKER_END } = __test;

describe('buildHstsBlock (§402)', () => {
  const block = buildHstsBlock();

  it('sets max-age to at least 15552000s, the floor Nextcloud\'s own check accepts', () => {
    expect(block).toContain('max-age=15552000');
  });

  it('applies unconditionally ("always"), not gated on a forwarded-proto check', () => {
    expect(block).toContain('Strict-Transport-Security');
    expect(block).toContain('always;');
    expect(block).not.toContain('X-Forwarded-Proto');
  });

  it('is fenced by the module\'s own markers', () => {
    expect(block.startsWith(HSTS_MARKER_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(HSTS_MARKER_END)).toBe(true);
  });
});
