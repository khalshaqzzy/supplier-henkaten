import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DropdownMenu, Tabs } from './advanced';
import {
  ApprovalRouteStatus,
  AssignmentState,
  FourMIndicator,
  HenkatenStatus,
  SourceModeBadge,
} from './domain';
import { ChartFrame } from './data-display';
import { Button, Field, Input, Pagination, SegmentedControl, Switch } from './primitives';

afterEach(cleanup);

describe('loading and form contracts', () => {
  it('exposes aria-busy, preserves label, and blocks duplicate submit', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Simpan perubahan
      </Button>,
    );

    const button = screen.getByRole('button', { name: /simpan perubahan/i });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('associates visible labels and field errors', () => {
    render(
      <Field label="Registration ID" htmlFor="registration" errorText="ID sudah digunakan.">
        <Input id="registration" error />
      </Field>,
    );

    expect(screen.getByLabelText('Registration ID')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('ID sudah digunakan.')).toBeVisible();
  });
});

describe('selection APIs', () => {
  it('supports controlled segmented selection', async () => {
    const user = userEvent.setup();
    function Example() {
      const [value, setValue] = useState('compact');
      return (
        <SegmentedControl
          label="Density"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'roomy', label: 'Roomy' },
          ]}
        />
      );
    }
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Roomy' }));
    expect(screen.getByRole('button', { name: 'Roomy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports controlled switch state', async () => {
    const user = userEvent.setup();
    function Example() {
      const [checked, setChecked] = useState(false);
      return <Switch label="Realtime updates" checked={checked} onCheckedChange={setChecked} />;
    }
    render(<Example />);
    const control = screen.getByRole('switch');
    await user.click(control);
    expect(control).toBeChecked();
  });

  it('enforces pagination boundaries', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Pagination page={1} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Halaman sebelumnya' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(<Pagination page={3} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Halaman berikutnya' })).toBeDisabled();
  });
});

describe('Radix keyboard and focus behavior', () => {
  it('moves tab selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        label="Henkaten detail"
        defaultValue="detail"
        items={[
          { value: 'detail', label: 'Detail', content: 'Detail panel' },
          { value: 'history', label: 'History', content: 'History panel' },
        ]}
      />,
    );
    const detail = screen.getByRole('tab', { name: 'Detail' });
    detail.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });

  it('closes a menu on Escape', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        label="Actions"
        trigger={<button type="button">Actions</button>}
        items={[{ label: 'Refresh' }, { label: 'Deactivate' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('menu')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('contains focus, closes on Escape, and returns focus to dialog trigger', async () => {
    const user = userEvent.setup();
    render(
      <Dialog
        trigger={<button type="button">Edit supplier</button>}
        title="Edit supplier"
        description="Update supplier details."
        footer={<Button>Save</Button>}
      >
        <Field label="Supplier name" htmlFor="supplier-name">
          <Input id="supplier-name" />
        </Field>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Edit supplier' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    expect(within(dialog).getByLabelText('Supplier name')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('domain enum mapping', () => {
  it('renders contract states with a label and icon', () => {
    render(
      <>
        <FourMIndicator category="MAN" />
        <SourceModeBadge mode="EXTERNAL" />
        <HenkatenStatus status="APPROVED" />
        <ApprovalRouteStatus route="QC" status="PENDING" />
        <AssignmentState state="VACANT" />
      </>,
    );

    expect(screen.getByText('Man')).toBeVisible();
    expect(screen.getByText('External')).toBeVisible();
    expect(screen.getByText('Approved')).toBeVisible();
    expect(screen.getByText('QC · Pending')).toBeVisible();
    expect(screen.getByText('Vacant')).toBeVisible();
    expect(document.querySelectorAll('svg').length).toBeGreaterThan(2);
  });
});

describe('chart states', () => {
  it('renders an explicit empty state instead of a blank plot', () => {
    render(
      <ChartFrame
        title="Trend"
        data={[]}
        xKey="period"
        series={[{ dataKey: 'open', label: 'Open', color: 'var(--hds-chart-2)' }]}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Belum ada data untuk ditampilkan.');
    expect(document.querySelector('.hds-chart__plot')).toBeNull();
  });

  it('keeps a definite chart plot and labels every series for one-point data', () => {
    render(
      <ChartFrame
        title="Trend"
        data={[{ period: '28 Jul', open: 1, approved: 2 }]}
        xKey="period"
        series={[
          { dataKey: 'open', label: 'Open', color: 'var(--hds-chart-2)' },
          { dataKey: 'approved', label: 'Approved', color: 'var(--hds-chart-3)' },
        ]}
      />,
    );

    expect(document.querySelector('.hds-chart__plot')).toBeTruthy();
    expect(screen.getByLabelText('Legenda grafik')).toHaveTextContent('Open');
    expect(screen.getByLabelText('Legenda grafik')).toHaveTextContent('Approved');
  });
});
