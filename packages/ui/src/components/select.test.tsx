import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from './primitives';
import { Select, type SelectOption } from './select';

const statuses: SelectOption[] = [
  { value: '', label: 'Semua status' },
  { value: 'OPEN', label: 'Open' },
  { value: 'APPROVED', label: 'Approved', description: 'Disetujui' },
  { value: 'REJECTED', label: 'Rejected', disabled: true },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function Controlled({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <Field label="Status" htmlFor="status">
      <Select
        id="status"
        value={value}
        options={statuses}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </Field>
  );
}

afterEach(cleanup);

describe('Select', () => {
  it('is named by its Field label and treats an empty value as a real option', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Controlled onChange={changed} />);
    const trigger = screen.getByRole('combobox', { name: 'Status' });
    expect(trigger).toHaveTextContent('Semua status');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Semua status' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(within(list).getByRole('option', { name: /Approved/ }));
    expect(changed).toHaveBeenCalledWith('APPROVED');
    expect(trigger).toHaveTextContent('Approved');
    expect(trigger).not.toHaveTextContent('Disetujui');
    expect(trigger).toHaveFocus();
  });

  it('supports keyboard selection, skips disabled options and typeahead', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Controlled onChange={changed} />);
    screen.getByRole('combobox', { name: 'Status' }).focus();
    await user.keyboard('{ArrowDown}');
    const list = screen.getByRole('listbox');
    expect(list).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(list.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Cancelled' }).id,
    );
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenLastCalledWith('CANCELLED');

    await user.keyboard('{Enter}');
    await user.keyboard('o');
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Open' }).id,
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('adds a filter to long lists and reports empty results', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const lines = Array.from({ length: 12 }, (_, index) => ({
      value: `line-${index + 1}`,
      label: `LINE-${String(index + 1).padStart(2, '0')}`,
      description: index === 6 ? 'Assembly utama' : `Line ${index + 1}`,
    }));
    render(
      <Select label="Line" options={lines} onValueChange={changed} placeholder="Pilih line" />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Line' });
    expect(trigger).toHaveTextContent('Pilih line');
    await user.click(trigger);
    const search = screen.getByRole('combobox', { name: 'Cari Line' });
    expect(search).toHaveFocus();
    await user.type(search, 'assembly');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('1 dari 12 pilihan')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(changed).toHaveBeenCalledWith('line-7');

    await user.click(trigger);
    await user.type(screen.getByRole('combobox', { name: 'Cari Line' }), 'zzz');
    expect(screen.getByText('Tidak ada pilihan yang cocok')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('renders groups, disabled reasons and a hidden form value', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <Select
          label="Pengganti"
          name="replacement"
          defaultValue="b"
          searchable={false}
          options={[
            { value: 'a', label: 'Ani', group: 'Tersedia' },
            { value: 'b', label: 'Budi', group: 'Tersedia', meta: 'REG-2' },
            { value: 'c', label: 'Cici', group: 'Tidak tersedia', disabledReason: 'Arsip' },
          ]}
        />
      </form>,
    );
    expect(container.querySelector<HTMLInputElement>('input[name="replacement"]')?.value).toBe('b');
    await user.click(screen.getByRole('combobox', { name: 'Pengganti' }));
    expect(screen.getByRole('group', { name: 'Tersedia' })).toBeInTheDocument();
    const unavailable = screen.getByRole('option', { name: /Cici/ });
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(unavailable).toHaveTextContent('Arsip');
    await user.click(unavailable);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('does not open when disabled and has no blocking axe violations', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <main>
        <Field label="Role" htmlFor="role">
          <Select id="role" value="MP" disabled options={[{ value: 'MP', label: 'MP' }]} />
        </Field>
        <Select label="Shift" options={statuses} />
      </main>,
    );
    const role = screen.getByRole('combobox', { name: 'Role' });
    expect(role).toBeDisabled();
    await user.click(role);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Shift' }));
    const results = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
    expect(container).toBeTruthy();
  });
});
