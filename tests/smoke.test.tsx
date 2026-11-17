import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { skipSetup } from '../src/state/setup';
import App from '../src/App';

test('app renders the diary, and offers logging from anywhere', async () => {
  // First launch shows the (skippable) setup form; the diary is what a person reaches after it. Logging moved
  // from a tab of its own to a button floating over every screen but Settings (amendment A2.4).
  skipSetup();
  render(<App />);
  expect(await screen.findByRole('heading', { name: /^diary$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Log what you ate' })).toBeInTheDocument();
});
