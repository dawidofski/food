import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { allEntriesIncludingTombstones, eraseEverything, putProfile } from '@/data/db';
import { loadFoods, resetFoodRepository } from '@/data/foodRepository';
import App from '@/App';
import { ownerProfile } from '../fixtures/profile';

const fromDisk = (async (url: string) => {
  const rel = String(url).replace(import.meta.env.BASE_URL, '');
  const body = readFileSync(resolve(__dirname, '../../public', rel), 'utf8');
  return { ok: true, status: 200, text: async () => body } as Response;
}) as typeof fetch;

beforeAll(async () => {
  resetFoodRepository();
  await loadFoods(fromDisk);
}, 60_000);

beforeEach(async () => {
  await eraseEverything();
  await putProfile(ownerProfile);
});
afterEach(cleanup);

const logButton = () => screen.getByRole('button', { name: 'Log what you ate' });
const goTo = (label: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: label }));

async function app() {
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
}

describe('logging from anywhere', () => {
  test('opens from the button and puts focus inside', async () => {
    await app();
    fireEvent.click(logButton());
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test('closes on Escape and returns focus to the button', async () => {
    await app();
    const button = logButton();
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(logButton());
  });

  test('pushes a history entry on open so the back gesture has something to consume', async () => {
    // Without this, back leaves the app instead of closing the dialog. A synthetic popstate event would
    // exercise the listener while proving nothing about the mechanism, so spy on history itself.
    const push = vi.spyOn(history, 'pushState');
    await app();
    fireEvent.click(logButton());
    await screen.findByRole('dialog', { name: 'Log what you ate' });
    expect(push).toHaveBeenCalledTimes(1);
  });

  test('closes on the back gesture without leaving the app', async () => {
    await app();
    fireEvent.click(logButton());
    await screen.findByRole('dialog', { name: 'Log what you ate' });
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 50)); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Still in the app, on the tab it was opened from.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  test('consumes its history entry when closed another way, so the back stack does not grow', async () => {
    const back = vi.spyOn(history, 'back');
    await app();
    const button = logButton();
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(back).toHaveBeenCalledTimes(1);
  });

  test('is offered on the diary, trends and food tabs and not on settings', async () => {
    await app();
    expect(logButton()).toBeInTheDocument();
    goTo('Trends');
    expect(logButton()).toBeInTheDocument();
    goTo('Food');
    expect(logButton()).toBeInTheDocument();
    goTo('Settings');
    expect(screen.queryByRole('button', { name: 'Log what you ate' })).toBeNull();
  });

  test('asks before throwing away what was typed, and keeps it when told to', async () => {
    await app();
    fireEvent.click(logButton());
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'half a sandwich' } });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    // Not gone: asked about.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Log what you ate' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /keep it/i })); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((within(screen.getByRole('dialog', { name: 'Log what you ate' })).getByRole('textbox') as HTMLInputElement).value).toBe('half a sandwich');
  });

  test('asks before a back gesture throws away what was typed', async () => {
    // The route the owner hits by accident on a phone. Back has already happened by the time we hear about
    // it, so keeping the entry means putting it back.
    await app();
    fireEvent.click(logButton());
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'half a sandwich' } });
    await act(async () => { history.back(); await new Promise((r) => setTimeout(r, 50)); });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Log what you ate' })).toBeInTheDocument();
  });

  test('closes without asking when there is nothing to lose', async () => {
    await app();
    fireEvent.click(logButton());
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  test('still runs the warning gate on an entry rather than storing it silently', async () => {
    await app();
    fireEvent.click(logButton());
    const dialog = await screen.findByRole('dialog', { name: 'Log what you ate' });
    const field = within(dialog).getByRole('textbox');
    fireEvent.change(field, { target: { value: 'a hot dog' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^log$/i })); });
    // Nothing is stored until the person passes the gate: the confirming control must be on screen.
    await waitFor(() => {
      const confirm = screen.queryByRole('button', { name: /add anyway|add it|^add$/i });
      expect(confirm).not.toBeNull();
    }, { timeout: 8000 });
    // And nothing reached the diary while the person was being asked.
    expect(await allEntriesIncludingTombstones()).toHaveLength(0);
  }, 20000);
});
