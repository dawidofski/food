import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('app renders the log screen heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /what did you eat/i })).toBeInTheDocument();
});
