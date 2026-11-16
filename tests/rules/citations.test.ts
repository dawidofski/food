import { expect, test } from 'vitest';
import { citationProblems } from '@/rules/citations';

const ok = { title: 'T', publisher: 'WHO', year: 2023, url: 'https://example.org/x', conclusion: 'A short statement.' };

test('a complete citation has no problems', () => {
  expect(citationProblems(ok)).toEqual([]);
});

test('a citation with only a URL is not readable offline', () => {
  expect(citationProblems({ ...ok, conclusion: '  ' })).toEqual([expect.stringMatching(/offline/)]);
});

test('bad year and url are reported', () => {
  expect(citationProblems({ ...ok, year: 20, url: 'ftp://x' })).toHaveLength(2);
});
