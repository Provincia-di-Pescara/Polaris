import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as authApi from '../api/auth.ts';
import { LoginView } from './LoginView.tsx';

describe('LoginView', () => {
  it('il bottone chiama avviaLoginOidc', async () => {
    const spy = vi.spyOn(authApi, 'avviaLoginOidc').mockImplementation(() => {});
    render(<LoginView />);

    await userEvent.click(screen.getByRole('button', { name: /accedi con spid/i }));

    expect(spy).toHaveBeenCalled();
  });
});
