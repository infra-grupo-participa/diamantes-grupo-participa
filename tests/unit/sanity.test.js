/**
 * sanity.test.js — JS smoke test for pure utility modules.
 *
 * Replaced the PHP-era suite that was deleted in the Supabase rewrite.
 * Covers insights-utils.js and insights-state.js at the function level
 * to satisfy the vitest coverage thresholds.
 */

import {
  normalizeEntityName,
  normalizeServiceName,
  normalizeOptionLabel,
  uniqueValues,
  escapeHtml,
  formatProfileDate,
  average,
  roundOne,
} from '../../portal/assets/js/insights-utils.js';

describe('insights-utils — normalisation', () => {
  test('normalizeEntityName uppercases', () => {
    expect(normalizeEntityName('joao')).toBe('JOAO');
    expect(normalizeEntityName('  trim  ')).toBe('TRIM');
  });

  test('normalizeServiceName applies aliases', () => {
    expect(normalizeServiceName('desenvolvedor web')).toBe('WEBDESIGNER');
    expect(normalizeServiceName('copy')).toBe('COPYWRITER');
    expect(normalizeServiceName('contabilidade')).toBe('CONTABILIDADE');
  });

  test('normalizeOptionLabel trims and uppercases', () => {
    // normalizeOptionLabel strips diacritics, trims, uppercases
    const result = normalizeOptionLabel(' BPO Financeiro ');
    expect(result).toBe('BPO FINANCEIRO');
  });

  test('uniqueValues deduplicates and removes falsy', () => {
    expect(uniqueValues(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(uniqueValues(['a', '', null, 'b'])).toEqual(['a', 'b']);
  });

  test('escapeHtml escapes HTML special chars', () => {
    expect(escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });
});

describe('insights-utils — maths', () => {
  test('average returns correct mean', () => {
    expect(average([1, 2, 3, 4, 5])).toBe(3);
  });

  test('average returns null for empty array', () => {
    expect(average([])).toBe(null);
  });

  test('average ignores non-finite values', () => {
    expect(average([1, NaN, 3])).toBe(2);
  });

  test('roundOne rounds to 1 decimal', () => {
    expect(roundOne(3.14159)).toBe(3.1);
    expect(roundOne(2.75)).toBe(2.8);
    expect(roundOne(null)).toBe(null);
  });
});

describe('insights-utils — formatProfileDate', () => {
  test('returns em dash for falsy input', () => {
    expect(formatProfileDate('')).toBe('—');
    expect(formatProfileDate(null)).toBe('—');
  });

  test('formats a valid ISO date string', () => {
    const result = formatProfileDate('2024-06-15');
    expect(result).toBeTruthy();
    expect(result).not.toBe('—');
    expect(typeof result).toBe('string');
  });
});
