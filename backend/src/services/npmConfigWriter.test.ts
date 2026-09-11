import { describe, expect, it } from 'vitest';
import { escapeRegExp, normaliseConf, replaceMarkedBlock } from './npmConfigWriter';

const BEGIN = '# >>> test >>>';
const END = '# <<< test <<<';

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so a literal marker matches literally', () => {
    const pattern = new RegExp(escapeRegExp('a.b*c'));
    expect(pattern.test('a.b*c')).toBe(true);
    expect(pattern.test('axbxc')).toBe(false);
  });
});

describe('normaliseConf', () => {
  it('collapses runs of blank lines, trims, and ensures one trailing newline', () => {
    expect(normaliseConf('\n\nfoo\n\n\n\nbar\n\n')).toBe('foo\n\nbar\n');
  });

  it('returns an empty string for all-whitespace input', () => {
    expect(normaliseConf('   \n\n  ')).toBe('');
  });
});

describe('replaceMarkedBlock (shared with crowdsecConfig, extracted §402)', () => {
  const block = `${BEGIN}\nadd_header X-Test 1;\n${END}`;

  it('appends the block to an empty file', () => {
    expect(replaceMarkedBlock('', BEGIN, END, block)).toBe(`${block}\n`);
  });

  it('replaces an existing block in place rather than appending a second one', () => {
    const once = replaceMarkedBlock('', BEGIN, END, block);
    const changed = `${BEGIN}\nadd_header X-Test 2;\n${END}`;
    const twice = replaceMarkedBlock(once, BEGIN, END, changed);
    expect(twice).toBe(`${changed}\n`);
    expect(twice.match(new RegExp(escapeRegExp(BEGIN), 'g'))).toHaveLength(1);
  });

  it('removes the block when passed null, leaving surrounding content untouched', () => {
    const withBlock = replaceMarkedBlock('# hand-written\n\n' + block, BEGIN, END, block);
    expect(replaceMarkedBlock(withBlock, BEGIN, END, null)).toBe('# hand-written\n');
  });
});
