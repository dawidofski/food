import { describe, expect, test, vi } from 'vitest';
import { createUpdateGate } from '@/state/updates';

describe('update gate', () => {
  test('applies a ready update at once when nothing is in progress', () => {
    const apply = vi.fn();
    const g = createUpdateGate();
    g.setApply(apply);
    g.notifyReady();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('holds a ready update while a gate or editor is open, and applies it on release', () => {
    const apply = vi.fn();
    const g = createUpdateGate();
    g.setApply(apply);
    const release = g.hold();
    g.notifyReady();
    expect(apply).not.toHaveBeenCalled();
    release();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('stays held until every hold is released, and releasing twice is harmless', () => {
    const apply = vi.fn();
    const g = createUpdateGate();
    g.setApply(apply);
    const a = g.hold();
    const b = g.hold();
    g.notifyReady();
    a();
    a();
    expect(apply).not.toHaveBeenCalled();
    b();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  test('a release with no update waiting applies nothing, and an update is applied only once', () => {
    const apply = vi.fn();
    const g = createUpdateGate();
    g.setApply(apply);
    g.hold()();
    expect(apply).not.toHaveBeenCalled();
    g.notifyReady();
    g.hold()();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
