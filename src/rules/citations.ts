import type { Citation } from './types';

/** Problems that make a citation unreadable offline or unverifiable. Empty means the citation is complete. */
export function citationProblems(c: Citation): string[] {
  const out: string[] = [];
  if (!c.title.trim()) out.push('title is empty');
  if (!c.publisher.trim()) out.push('publisher is empty');
  if (!Number.isInteger(c.year) || c.year < 1900 || c.year > 2100) out.push('year is not a plausible year');
  if (!/^https?:\/\/\S+$/.test(c.url)) out.push('url is not an http(s) URL');
  if (!c.conclusion.trim()) out.push('conclusion is empty: the claim is not readable offline');
  return out;
}
