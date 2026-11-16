import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { skipSetup } from '../src/state/setup';
import App from '../src/App';

test('app renders the log screen heading', async () => {
  // First launch shows the (skippable) setup form; the log is what a person reaches after it.
  skipSetup();
  render(<App />);
  expect(await screen.findByRole('heading', { name: /what did you eat/i })).toBeInTheDocument();
});
