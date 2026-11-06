import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchSelect } from './search-select';

const options = [
  { value: 'a', label: 'Dewi Santoso', description: '00102 · MP-A' },
  { value: 'b', label: 'Dewi Santoso', description: '00103 · MP-B' },
  { value: 'c', label: 'Budi', description: '00200', disabledReason: 'Ditugaskan di L01 · Malam' },
];
describe('SearchSelect', () => {
  it('separates query from selected identity and selects by keyboard using code and registration', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<SearchSelect label="MP" value="a" options={options} onValueChange={changed} />);
    await user.click(screen.getByRole('button', { name: 'MP Dewi Santoso' }));
    const search = screen.getByRole('combobox', { name: 'Cari MP' });
    await user.type(search, 'mp-b 00103');
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MP Dewi Santoso' })).toHaveFocus();
  });
  it('keeps occupied members visible with explanations and skips them on keyboard navigation', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<SearchSelect label="LL" value="" options={options} onValueChange={changed} />);
    await user.click(screen.getByRole('button', { name: /LL Pilih member/ }));
    expect(screen.getByRole('option', { name: /Budi/ })).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByRole('combobox'), 'budi');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('option', { name: /Budi/ }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText('Ditugaskan di L01 · Malam')).toBeVisible();
  });
  it('shows empty results, restores choices and clears the committed assignment explicitly', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<SearchSelect label="Supervisor" value="a" options={options} onValueChange={changed} />);
    await user.click(screen.getByRole('button', { name: /Supervisor Dewi/ }));
    await user.type(screen.getByRole('combobox'), 'xyz');
    expect(screen.getByText('Member tidak ditemukan')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Bersihkan pencarian' }));
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.click(screen.getByRole('option', { name: 'Tanpa assignment' }));
    expect(changed).toHaveBeenCalledWith('');
  });
});
