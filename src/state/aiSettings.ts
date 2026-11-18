import { lsKey } from '@/data/db';

/**
 * The DeepSeek key and its on/off switch. Both live in this browser's localStorage under the app's
 * prefix, so "erase everything" removes them and nothing is ever bundled or committed. The key is
 * only ever read to build an Authorization header.
 *
 * The fallback is OFF until a key exists AND the person has switched it on. Storing a key alone
 * never starts sending text anywhere: the switch is the consent, and the Settings screen states
 * what is sent before it can be flipped.
 */
export const API_KEY_LS = lsKey('ai.deepseekKey');
const KEY = API_KEY_LS;
const SWITCH = lsKey('ai.enabled');

export function getApiKey(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v !== null && v.trim() !== '' ? v : null;
  } catch {
    return null;
  }
}

/** Stores a trimmed key; a blank key clears instead. Throws if storage is unavailable, so the UI can say so. */
export function setApiKey(key: string): void {
  const k = key.trim();
  if (k === '') {
    clearApiKey();
    return;
  }
  localStorage.setItem(KEY, k);
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(SWITCH);
  } catch {
    /* nothing to clear in unreadable storage */
  }
}

export function isAiSwitchedOn(): boolean {
  try {
    return localStorage.getItem(SWITCH) === '1';
  } catch {
    return false;
  }
}

export function setAiSwitch(on: boolean): void {
  if (on) localStorage.setItem(SWITCH, '1');
  else localStorage.removeItem(SWITCH);
}

/** True only with a key present and the switch on. */
export function isAiEnabled(): boolean {
  return getApiKey() !== null && isAiSwitchedOn();
}

/**
 * A separate switch for sending a PHOTOGRAPH to a third party.
 *
 * Deliberately not the same switch as the phrase fallback. Agreeing that an unrecognised food word may be sent
 * is a different decision from agreeing that a picture taken with the phone's camera may be: a photograph can
 * carry a kitchen, a face, a hand, an address on a letter behind the packet. Someone who said yes to one has
 * not said yes to the other, and the app must not read the first as consent for the second.
 */
const LABEL_SWITCH = lsKey('ai.labelPhoto');

export function isLabelPhotoSwitchedOn(): boolean {
  try {
    return localStorage.getItem(LABEL_SWITCH) === '1';
  } catch {
    return false;
  }
}

export function setLabelPhotoSwitch(on: boolean): void {
  try {
    if (on) localStorage.setItem(LABEL_SWITCH, '1');
    else localStorage.removeItem(LABEL_SWITCH);
  } catch {
    /* nothing to store in unreadable storage; the feature simply stays off */
  }
}

/** True only with a key, the AI switch on, AND this separate agreement to send a photograph. */
export function isLabelPhotoEnabled(): boolean {
  return isAiEnabled() && isLabelPhotoSwitchedOn();
}

/** Last four characters visible, the rest dots; a key of four or fewer characters is fully masked. */
export function maskKey(key: string): string {
  if (key.length <= 4) return '•'.repeat(key.length);
  return '•'.repeat(Math.min(key.length - 4, 12)) + key.slice(-4);
}
