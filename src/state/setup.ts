import { lsKey } from '@/data/db';

/**
 * Whether the person chose to skip first-run setup. The app works without a profile (generic adult
 * targets, said so wherever they are used), so skipping is a normal choice, remembered so the form is
 * not shown on every launch. Stored under the app prefix, so "erase everything" removes it.
 */
const SKIPPED = lsKey('setup.skipped');

export function isSetupSkipped(): boolean {
  try {
    return localStorage.getItem(SKIPPED) === '1';
  } catch {
    return false;
  }
}

export function skipSetup(): void {
  try {
    localStorage.setItem(SKIPPED, '1');
  } catch {
    /* if storage is blocked the form simply shows again next launch */
  }
}
