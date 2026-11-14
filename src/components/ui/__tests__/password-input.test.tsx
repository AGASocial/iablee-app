import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from '../password-input';

describe('PasswordInput', () => {
  it('toggles input type and aria-label between show and hide', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="password" />);

    const input = screen.getByLabelText('password', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'showPassword' });
    await user.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'hidePassword' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'hidePassword' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'showPassword' })).toBeInTheDocument();
  });

  it('does not submit a form when the toggle is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="password" />
        <button type="submit">Submit</button>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'showPassword' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
