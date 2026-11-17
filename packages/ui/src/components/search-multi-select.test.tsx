import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchMultiSelect, type SearchMultiSelectOption } from './search-multi-select';

const options: SearchMultiSelectOption[] = [
  { value: 'a', label: 'Dewi Santoso', description: '00102', note: 'Juga memimpin L02 · Pagi' },
  { value: 'b', label: 'Budi Hartono', description: '00103' },
  { value: 'c', label: 'Citra Lestari', description: '00104' },
  { value: 'd', label: 'Agus Pratama', description: '00105', disabledReason: 'Akun belum aktif' },
];

function Harness({ initial = [], max }: { initial?: string[]; max?: number }) {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <SearchMultiSelect
      label="Line Leader"
      values={values}
      options={options}
      onValuesChange={setValues}
      {...(max !== undefined ? { max } : {})}
    />
  );
}

afterEach(cleanup);

describe('SearchMultiSelect', () => {
  it('adds several leaders in one pass in the order chosen and keeps the popover open', async () => {
    const user = userEvent.setup();
    render(<Harness max={10} />);
    expect(screen.getByText('Belum ada Line Leader')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tambah Line Leader' }));
    await user.type(screen.getByRole('combobox', { name: 'Cari Line Leader' }), '00103');
    await user.keyboard('{Enter}');
    await user.clear(screen.getByRole('combobox', { name: 'Cari Line Leader' }));
    await user.click(screen.getByRole('option', { name: /Dewi Santoso/ }));
    expect(screen.getByRole('option', { name: /Dewi Santoso/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Selesai' }));
    const selected = screen.getByRole('list', { name: 'Line Leader terpilih' });
    expect(selected.textContent).toMatch(/Budi Hartono.*Dewi Santoso/);
    expect(screen.getByText('Juga memimpin L02 · Pagi')).toBeVisible();
    expect(screen.getByText('2/10')).toBeVisible();
  });

  it('removes a selected leader and blocks unavailable or over-limit choices', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const { rerender } = render(
      <SearchMultiSelect
        label="Line Leader"
        values={['a']}
        options={options}
        onValuesChange={changed}
        max={1}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Hapus Dewi Santoso' }));
    expect(changed).toHaveBeenLastCalledWith([]);
    await user.click(screen.getByRole('button', { name: 'Tambah Line Leader' }));
    expect(screen.getByRole('option', { name: /Budi Hartono/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getAllByText('Maksimal 1 dipilih').length).toBeGreaterThan(0);
    rerender(
      <SearchMultiSelect
        label="Line Leader"
        values={[]}
        options={options}
        onValuesChange={changed}
        max={1}
      />,
    );
    changed.mockClear();
    await user.click(screen.getByRole('option', { name: /Agus Pratama/ }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText('Akun belum aktif')).toBeVisible();
  });
});
