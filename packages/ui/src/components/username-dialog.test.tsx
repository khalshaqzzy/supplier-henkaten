import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './primitives';
import { UsernameDialog } from './username-dialog';

afterEach(cleanup);

describe('UsernameDialog', () => {
  it('saves a trimmed new username and closes', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(undefined);
    render(
      <UsernameDialog
        trigger={<Button>Ubah username</Button>}
        owner="Dewi Santoso"
        username="dewi.s"
        onSubmit={submit}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Ubah username' }));
    const input = screen.getByLabelText(/Username baru/);
    expect(input).toHaveValue('dewi.s');
    expect(screen.getByRole('button', { name: 'Simpan username' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '  dewi.santoso  ');
    await user.click(screen.getByRole('button', { name: 'Simpan username' }));
    expect(submit).toHaveBeenCalledWith('dewi.santoso');
    expect(screen.queryByLabelText(/Username baru/)).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the described error when saving fails', async () => {
    const user = userEvent.setup();
    render(
      <UsernameDialog
        trigger={<Button>Ubah username</Button>}
        owner="Dewi Santoso"
        username="dewi.s"
        onSubmit={() => Promise.reject(new Error('taken'))}
        describeError={() => 'Username sudah digunakan akun lain.'}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Ubah username' }));
    await user.type(screen.getByLabelText(/Username baru/), '2');
    await user.click(screen.getByRole('button', { name: 'Simpan username' }));
    expect(await screen.findByText('Username sudah digunakan akun lain.')).toBeVisible();
    expect(screen.getByLabelText(/Username baru/)).toHaveValue('dewi.s2');
  });
});
