// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HenkatenCategory, WorkingAssignment } from '@tmmin-henkaten/contracts';

import {
  ApprovalTimeline,
  ChecklistResponseList,
  HenkatenCategoryPicker,
  ManMovementPreview,
  ObjectTransitionEvidence,
  ReadinessList,
} from './HenkatenWorkflow';

afterEach(cleanup);

describe('Henkaten workflow presentation', () => {
  it('exposes the 4M selector as one accessible choice and updates its selected state', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [category, setCategory] = useState<HenkatenCategory>('MAN');
      return <HenkatenCategoryPicker value={category} onChange={setCategory} />;
    }

    render(<Harness />);

    const expectedDots = {
      Man: 'man',
      Machine: 'machine',
      Material: 'material',
      Method: 'method',
    } as const;
    for (const [label, category] of Object.entries(expectedDots)) {
      expect(
        screen
          .getByRole('radio', { name: label })
          .querySelector('.hds-4m-dot')
          ?.classList.contains(`hds-4m-dot--${category}`),
      ).toBe(true);
    }

    expect(screen.getByRole('radio', { name: 'Man' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Material' }));
    expect(screen.getByRole('radio', { name: 'Man' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Material' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('distinguishes checklist Yes, No, and unanswered from form readiness', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(
      <>
        <ChecklistResponseList
          items={[
            { id: 'safety', label: 'Safety point diverifikasi' },
            { id: 'quality', label: 'Quality point diverifikasi' },
          ]}
          answers={{ safety: 'YES' }}
          onChange={onChange}
        />
        <ReadinessList
          items={[
            { label: 'Konteks operasional', complete: true, detail: 'Lengkap' },
            { label: 'Checklist', complete: false, detail: '1 item belum dijawab' },
          ]}
        />
      </>,
    );

    expect(screen.getByText('Memenuhi persyaratan')).toBeTruthy();
    expect(screen.getByText('Belum dijawab')).toBeTruthy();
    expect(screen.getByText('1 item belum dijawab')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'No' })[0]!);
    expect(onChange).toHaveBeenCalledWith('safety', 'NO');

    rerender(
      <ChecklistResponseList
        items={[{ id: 'safety', label: 'Safety point diverifikasi' }]}
        answers={{ safety: 'NO' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Jawaban No memblokir submission')).toBeTruthy();
  });

  it('renders actual movement, object transition, and parallel route evidence', () => {
    const target: WorkingAssignment = {
      id: '00000000-0000-4000-8000-000000000001',
      shiftRunId: '00000000-0000-4000-8000-000000000002',
      lineId: '00000000-0000-4000-8000-000000000003',
      jobId: '00000000-0000-4000-8000-000000000004',
      jobName: 'Inspection',
      jobDisplayOrder: 1,
      effectiveMpMemberId: '00000000-0000-4000-8000-000000000005',
      candidateMpMemberId: '00000000-0000-4000-8000-000000000005',
      mpName: 'Operator Lama',
      mpRegistrationNumber: 'REG-001',
      state: 'ASSIGNED',
      active: true,
      version: 1,
    };

    render(
      <>
        <ManMovementPreview
          target={target}
          targetLine="Line A"
          replacement={{
            id: '00000000-0000-4000-8000-000000000006',
            fullName: 'Operator Baru',
            registrationNumber: 'REG-002',
            reserved: true,
            currentAssignment: { lineName: 'Line B', jobName: 'Packing' },
          }}
        />
        <ObjectTransitionEvidence category="MACHINE" affected="Machine A" replacement="Machine B" />
        <ApprovalTimeline
          creatorName="Line Leader"
          status="OPEN"
          supervisor={{
            route: 'SUPERVISOR',
            status: 'APPROVED',
            currentResponsibleName: 'Supervisor A',
            decision: {
              actorName: 'Supervisor A',
              actorRole: 'SUPERVISOR',
              comment: 'Kondisi aman.',
              decidedAt: '2026-07-28T01:00:00.000Z',
            },
          }}
          qc={{
            route: 'QC',
            status: 'NOT_REQUIRED',
            currentResponsibleName: 'QC A',
            decision: null,
          }}
          formatDate={() => '28 Jul 2026, 08.00'}
        />
      </>,
    );

    expect(screen.getByText('Operator Lama')).toBeTruthy();
    expect(screen.getByText('Reserved')).toBeTruthy();
    expect(screen.getByText('Machine A')).toBeTruthy();
    expect(screen.getByText('Machine B')).toBeTruthy();
    expect(screen.getByText('Kondisi aman.')).toBeTruthy();
    expect(screen.getByText('Tidak diperlukan')).toBeTruthy();
    expect(screen.getByText('Belum terminal')).toBeTruthy();
  });
});
