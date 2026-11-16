import { beforeEach, describe, expect, test } from 'vitest';
import { clearApiKey, getApiKey, isAiEnabled, isAiSwitchedOn, maskKey, setAiSwitch, setApiKey } from '@/state/aiSettings';
import { LS_PREFIX } from '@/data/db';

beforeEach(() => localStorage.clear());

describe('ai settings', () => {
  test('the fallback is off until a key is entered', () => {
    clearApiKey();
    expect(isAiEnabled()).toBe(false);
  });

  test('a stored key alone does not enable it; the person must also switch it on', () => {
    setApiKey('test-key-abcd1234');
    expect(getApiKey()).toBe('test-key-abcd1234');
    expect(isAiEnabled()).toBe(false);
    setAiSwitch(true);
    expect(isAiEnabled()).toBe(true);
  });

  test('switching off keeps the key', () => {
    setApiKey('test-key-abcd1234');
    setAiSwitch(true);
    setAiSwitch(false);
    expect(isAiEnabled()).toBe(false);
    expect(getApiKey()).toBe('test-key-abcd1234');
  });

  test('the switch cannot be on without a key, and clearing removes both', () => {
    setAiSwitch(true);
    expect(isAiEnabled()).toBe(false);
    setApiKey('test-key-abcd1234');
    setAiSwitch(true);
    clearApiKey();
    expect(getApiKey()).toBeNull();
    expect(isAiSwitchedOn()).toBe(false);
    setApiKey('test-key-other');
    expect(isAiEnabled()).toBe(false);
  });

  test('a blank key is not a key', () => {
    setApiKey('   ');
    expect(getApiKey()).toBeNull();
  });

  test('everything lives under the app prefix, so erasing everything removes it', () => {
    setApiKey('test-key-abcd1234');
    setAiSwitch(true);
    const keys = Object.keys(localStorage);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith(LS_PREFIX)).toBe(true);
  });

  test('the key is masked to its last four characters', () => {
    expect(maskKey('test-key-abcd1234')).toMatch(/^•+1234$/);
    expect(maskKey('test-key-abcd1234')).not.toContain('abcd');
    expect(maskKey('abc')).toBe('•••');
  });

  test('unreadable storage reads as off, never throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      expect(isAiEnabled()).toBe(false);
      expect(getApiKey()).toBeNull();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });
});
