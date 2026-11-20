// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiMutationUncertainError } from '@tmmin-henkaten/api-client';
import { supplierApi } from '../app/api';
import { useSession } from '../app/session';
import { HenkatenCreatePage } from './HenkatenCreatePage';
import { chooseOption } from '../test/select';

vi.mock('../app/session', () => ({ useSession: vi.fn() }));
// The part picker popover measures its arrow, which jsdom cannot observe.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('retries an uncertain submission with the same key and displayed assignment context', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  const initial = {
    items: [
      {
        id: 'shift',
        version: 1,
        lineCode: 'L1',
        lineName: 'Line',
        shiftName: 'Shift',
        startTime: '00:00',
        endTime: '23:59',
        current: true,
        businessDate: '2026-09-30',
        effectiveStartAt: '2026-09-30T00:00:00Z',
        effectiveEndAt: '2026-09-30T23:59:00Z',
        assignments: [{ id: 'assignment', jobId: 'job', jobName: 'Job', mpMemberId: 'mp' }],
      },
    ],
  };
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue(initial as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [],
    replacementMembers: [],
    checklist: { id: 'checklist', items: [{ id: 'item', label: 'Checked' }] },
  } as never);
  const submit = vi
    .spyOn(supplierApi, 'createHenkaten')
    .mockRejectedValue(new ApiMutationUncertainError());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText(/Job/)).toHaveProperty('disabled', false));
  await user.click(screen.getByRole('radio', { name: 'Machine' }));
  await chooseOption(user, screen.getByLabelText(/Job/), 'job');
  await chooseOption(user, screen.getByLabelText(/^Part/), 'OTHER');
  await user.type(screen.getByLabelText(/Objek terdampak/), 'A');
  await user.type(screen.getByLabelText(/Kondisi baru/), 'B');
  await user.type(screen.getByLabelText(/Penyebab/), 'Cause');
  await user.type(screen.getByLabelText(/Detail kejadian/), 'Detail');
  await user.click(screen.getByRole('button', { name: 'Yes' }));
  // Simulate a background refresh after the form was opened.
  const queries = client
    .getQueryCache()
    .findAll()
    .filter((query) => query.queryKey.includes('line-shift-operational-context'));
  for (const query of queries)
    client.setQueryData(query.queryKey, {
      items: [{ ...initial.items[0], version: 2, effectiveStartAt: '2026-10-01T00:00:00Z' }],
    });
  await user.click(screen.getByRole('button', { name: 'Submit Henkaten' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await screen.findByText('Henkaten tidak dapat disimpan.');
  for (const query of client
    .getQueryCache()
    .findAll()
    .filter((query) => query.queryKey.includes('henkaten-form-options'))) {
    client.setQueryData(query.queryKey, {
      parts: [],
      replacementMembers: [],
      checklist: { id: 'new-checklist', items: [{ id: 'new-item', label: 'New question' }] },
    });
  }
  expect(screen.getByLabelText(/Detail kejadian/).closest('fieldset')?.disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Submit Henkaten' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1]![1]).toBe(submit.mock.calls[0]![1]);
  expect(submit.mock.calls[1]![0]).toEqual(submit.mock.calls[0]![0]);
  expect(submit.mock.calls[0]![0]).toMatchObject({
    expectedLineShiftVersion: 1,
    expectedEffectiveStartAt: initial.items[0]!.effectiveStartAt,
  });
  client.clear();
});

it('lets a leader of several Line–Shifts choose the occurrence for the Henkaten', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  const shift = {
    id: 'shift',
    version: 1,
    lineCode: 'L1',
    lineName: 'Body Line',
    shiftName: 'Pagi',
    startTime: '07:00',
    endTime: '15:00',
    current: true,
    effectiveStartAt: '2026-09-30T00:00:00Z',
    effectiveEndAt: '2026-09-30T08:00:00Z',
    assignments: [{ id: 'assignment', jobId: 'job', jobName: 'Job', mpMemberId: 'mp' }],
  };
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue({
    items: [
      shift,
      {
        ...shift,
        id: 'other',
        lineCode: 'L2',
        lineName: 'Paint Line',
        assignments: [{ id: 'assignment-2', jobId: 'job-2', jobName: 'Spray', mpMemberId: 'mp' }],
      },
    ],
    currentLineShiftIds: ['shift', 'other'],
  } as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [],
    replacementMembers: [],
    checklist: null,
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const group = await screen.findByRole('radiogroup', { name: 'Pilih Line–Shift' });
  expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  expect(screen.queryByText('Line shift tidak tersedia')).toBeNull();
  expect(screen.getByLabelText(/Job/)).toHaveProperty('disabled', true);
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: /Paint Line/ }));
  await waitFor(() => expect(screen.getByLabelText(/Job/)).toHaveProperty('disabled', false));
  client.clear();
});

it.each(['absent', 'empty', 'unanswered', 'partial', 'no'] as const)(
  'submits an optional %s checklist immediately without confirmation',
  async (state) => {
    vi.mocked(useSession).mockReturnValue({
      session: {
        principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
        supplier: { id: 'supplier' },
      },
    } as ReturnType<typeof useSession>);
    vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue({
      items: [
        {
          id: 'shift',
          version: 1,
          lineName: 'Line',
          effectiveStartAt: '2026-09-30T00:00:00Z',
          effectiveEndAt: '2026-09-30T23:59:00Z',
          assignments: [{ id: 'assignment', jobId: 'job', jobName: 'Job', mpMemberId: 'mp' }],
        },
      ],
    } as never);
    vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
      parts: [],
      replacementMembers: [],
      checklist:
        state === 'absent'
          ? null
          : {
              id: 'checklist',
              items:
                state === 'empty'
                  ? []
                  : [
                      { id: 'one', label: 'First question' },
                      { id: 'two', label: 'Second question' },
                    ],
            },
    } as never);
    const submit = vi
      .spyOn(supplierApi, 'createHenkaten')
      .mockRejectedValue(new ApiMutationUncertainError());
    const confirm = vi.spyOn(window, 'confirm');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HenkatenCreatePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText(/Job/)).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('radio', { name: 'Machine' }));
    await chooseOption(user, screen.getByLabelText(/Job/), 'job');
    await chooseOption(user, screen.getByLabelText(/^Part/), 'OTHER');
    await user.type(screen.getByLabelText(/Objek terdampak/), 'Before');
    await user.type(screen.getByLabelText(/Kondisi baru/), 'After');
    await user.type(screen.getByLabelText(/Penyebab/), 'Cause');
    await user.type(screen.getByLabelText(/Detail kejadian/), 'Detail');
    if (state === 'partial') await user.click(screen.getAllByRole('button', { name: 'Yes' })[0]!);
    if (state === 'no') await user.click(screen.getAllByRole('button', { name: 'No' })[0]!);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Submit Henkaten' }).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Submit Henkaten' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    const payload = submit.mock.calls[0]![0];
    expect(payload.checklistAnswers).toEqual(
      state === 'absent'
        ? undefined
        : state === 'partial'
          ? [{ itemId: 'one', answer: 'YES' }]
          : state === 'no'
            ? [{ itemId: 'one', answer: 'NO' }]
            : [],
    );
    expect(payload.checklistVersionId).toBe(state === 'absent' ? undefined : 'checklist');
    client.clear();
  },
);

it('submits several selected parts in the order they were chosen', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue({
    items: [
      {
        id: 'shift',
        version: 1,
        lineName: 'Line',
        effectiveStartAt: '2026-09-30T00:00:00Z',
        effectiveEndAt: '2026-09-30T23:59:00Z',
        assignments: [{ id: 'assignment', jobId: 'job', jobName: 'Job', mpMemberId: 'mp' }],
      },
    ],
  } as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [
      { id: 'part-a', partNumber: 'P-A', partName: 'Bracket' },
      { id: 'part-b', partNumber: 'P-B', partName: 'Clip' },
      { id: 'part-c', partNumber: 'P-C', partName: 'Hinge' },
    ],
    replacementMembers: [],
    checklist: null,
  } as never);
  const submit = vi
    .spyOn(supplierApi, 'createHenkaten')
    .mockRejectedValue(new ApiMutationUncertainError());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText(/Job/)).toHaveProperty('disabled', false));
  await user.click(screen.getByRole('radio', { name: 'Machine' }));
  await chooseOption(user, screen.getByLabelText(/Job/), 'job');

  const trigger = screen.getByLabelText(/^Part/);
  await user.click(trigger);
  const listbox = await screen.findByRole('listbox');
  const option = (value: string) =>
    listbox.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)!;
  // The list stays open so several parts can be picked in one pass.
  await user.click(option('part-c'));
  await user.click(option('part-a'));
  await user.click(option('part-b'));
  await user.click(option('part-b'));
  expect(option('part-c').getAttribute('aria-selected')).toBe('true');
  expect(option('part-b').getAttribute('aria-selected')).toBe('false');
  await user.click(screen.getByRole('button', { name: 'Selesai' }));
  expect(trigger.textContent).toContain('2 part dipilih');

  // Choosing Other replaces the catalog selection; picking a part again clears Other.
  await chooseOption(user, trigger, 'OTHER');
  expect(trigger.textContent).toContain('Other');
  await user.click(trigger);
  await user.click(
    (await screen.findByRole('listbox')).querySelector<HTMLElement>('[data-value="part-b"]')!,
  );
  await user.click(screen.getByRole('button', { name: 'Selesai' }));
  await chooseOption(user, trigger, 'part-a');
  await user.click(screen.getByRole('button', { name: 'Selesai' }));
  await user.click(screen.getByRole('button', { name: 'Hapus pilihan part P-B' }));
  await chooseOption(user, trigger, 'part-c');
  await user.click(screen.getByRole('button', { name: 'Selesai' }));

  await user.type(screen.getByLabelText(/Objek terdampak/), 'Before');
  await user.type(screen.getByLabelText(/Kondisi baru/), 'After');
  await user.type(screen.getByLabelText(/Penyebab/), 'Cause');
  await user.type(screen.getByLabelText(/Detail kejadian/), 'Detail');
  await user.click(screen.getByRole('button', { name: 'Submit Henkaten' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0]![0]).toMatchObject({ partIds: ['part-a', 'part-c'] });
  expect(submit.mock.calls[0]![0]).not.toHaveProperty('otherPart');
  expect(submit.mock.calls[0]![0]).not.toHaveProperty('partId');
  client.clear();
});

it('auto-syncs swapped shift times while the form is untouched, and prompts without losing inputs once edited', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  const beforeSwap = {
    items: [
      {
        id: 'shift',
        version: 1,
        lineCode: 'L1',
        lineName: 'Body Line',
        shiftName: 'Shift 1',
        startTime: '07:00',
        endTime: '15:00',
        crossesMidnight: false,
        current: true,
        businessDate: '2026-11-20',
        effectiveStartAt: '2026-11-20T00:00:00Z',
        effectiveEndAt: '2026-11-20T08:00:00Z',
        assignments: [{ id: 'assignment', jobId: 'job', jobName: 'Job 1', mpMemberId: 'mp' }],
      },
    ],
    currentLineShiftIds: ['shift'],
  };
  const afterFirstSwap = {
    items: [
      {
        ...beforeSwap.items[0]!,
        version: 2,
        startTime: '19:00',
        endTime: '07:00',
        crossesMidnight: true,
        current: false,
        effectiveStartAt: '2026-11-20T12:00:00Z',
        effectiveEndAt: '2026-11-21T00:00:00Z',
      },
    ],
    currentLineShiftIds: [],
  };
  const afterSecondSwap = {
    items: [
      {
        ...beforeSwap.items[0]!,
        version: 3,
        startTime: '08:00',
        endTime: '16:00',
        crossesMidnight: false,
        current: true,
        effectiveStartAt: '2026-11-20T01:00:00Z',
        effectiveEndAt: '2026-11-20T09:00:00Z',
      },
    ],
    currentLineShiftIds: ['shift'],
  };
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue(beforeSwap as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [],
    replacementMembers: [],
    checklist: null,
  } as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(/Shift 1 · 07:00–15:00/);

  const updateContextCache = (next: typeof beforeSwap) => {
    for (const query of client
      .getQueryCache()
      .findAll()
      .filter((item) => item.queryKey.includes('line-shift-operational-context'))) {
      client.setQueryData(query.queryKey, next);
    }
  };

  // While the form is untouched, swapped shift times sync automatically with no blocking banner.
  updateContextCache(afterFirstSwap);
  await screen.findByText(/Shift 1 · 19:00–07:00/);
  expect(screen.queryByRole('button', { name: 'Perbarui jadwal' })).toBeNull();

  // Once the Line Leader starts filling inputs, a schedule change shows a 1-click refresh banner
  // that updates shift times while keeping all typed fields intact.
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Penyebab/), 'Rotasi operator');
  updateContextCache(afterSecondSwap);
  const refreshButton = await screen.findByRole('button', { name: 'Perbarui jadwal' });
  expect(screen.getByText(/Shift 1 · 19:00–07:00/)).toBeTruthy();

  await user.click(refreshButton);
  await screen.findByText(/Shift 1 · 08:00–16:00/);
  expect(screen.queryByRole('button', { name: 'Perbarui jadwal' })).toBeNull();
  expect(screen.getByLabelText<HTMLTextAreaElement>(/Penyebab/).value).toBe('Rotasi operator');
  client.clear();
});

it('preserves the drafted Line–Shift when a swap flips the current shift, and requires an explicit choice if it disappears', async () => {
  vi.mocked(useSession).mockReturnValue({
    session: {
      principal: { userId: 'user', role: 'LINE_LEADER', purpose: 'NORMAL' },
      supplier: { id: 'supplier' },
    },
  } as ReturnType<typeof useSession>);
  const sharedAssignment = { id: 'a1', jobId: 'job-1', jobName: 'Job 1', mpMemberId: 'mp-1' };
  const shiftA = {
    id: 'shift-a',
    version: 1,
    lineCode: 'L1',
    lineName: 'Body Line',
    shiftName: 'Shift A',
    startTime: '07:00',
    endTime: '15:00',
    crossesMidnight: false,
    current: true,
    businessDate: '2026-11-20',
    effectiveStartAt: '2026-11-20T00:00:00Z',
    effectiveEndAt: '2026-11-20T08:00:00Z',
    assignments: [sharedAssignment],
  };
  const shiftB = {
    id: 'shift-b',
    version: 1,
    lineCode: 'L1',
    lineName: 'Body Line',
    shiftName: 'Shift B',
    startTime: '19:00',
    endTime: '07:00',
    crossesMidnight: true,
    current: false,
    businessDate: '2026-11-20',
    effectiveStartAt: '2026-11-20T12:00:00Z',
    effectiveEndAt: '2026-11-21T00:00:00Z',
    assignments: [{ ...sharedAssignment, id: 'a2' }],
  };
  const shiftC = {
    id: 'shift-c',
    version: 1,
    lineCode: 'L2',
    lineName: 'Paint Line',
    shiftName: 'Shift C',
    startTime: '23:00',
    endTime: '07:00',
    crossesMidnight: true,
    current: false,
    businessDate: '2026-11-20',
    effectiveStartAt: '2026-11-20T16:00:00Z',
    effectiveEndAt: '2026-11-21T00:00:00Z',
    assignments: [{ id: 'a3', jobId: 'job-2', jobName: 'Job 2', mpMemberId: 'mp-2' }],
  };
  vi.spyOn(supplierApi, 'lineShiftOperationalContext').mockResolvedValue({
    items: [shiftA, shiftB],
    currentLineShiftIds: ['shift-a'],
  } as never);
  vi.spyOn(supplierApi, 'henkatenFormOptions').mockResolvedValue({
    parts: [],
    replacementMembers: [],
    checklist: null,
  } as never);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HenkatenCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const radioA = () => screen.getByRole<HTMLInputElement>('radio', { name: /Shift A/ });
  const radioB = () => screen.getByRole<HTMLInputElement>('radio', { name: /Shift B/ });
  await waitFor(() => expect(radioA().checked).toBe(true));

  await user.type(screen.getByLabelText(/Penyebab/), 'Draft for Shift A');
  const setContextCache = (next: unknown) => {
    for (const query of client
      .getQueryCache()
      .findAll()
      .filter((item) => item.queryKey.includes('line-shift-operational-context'))) {
      client.setQueryData(query.queryKey, next);
    }
  };

  // Swap makes Shift B the sole current shift on the same line; refresh must keep Shift A selected.
  setContextCache({
    items: [
      { ...shiftA, version: 2, startTime: '19:00', endTime: '07:00', current: false },
      { ...shiftB, version: 2, startTime: '07:00', endTime: '15:00', current: true },
    ],
    currentLineShiftIds: ['shift-b'],
  });
  await user.click(await screen.findByRole('button', { name: 'Perbarui jadwal' }));
  await waitFor(() => expect(radioA().checked).toBe(true));
  expect(radioB().checked).toBe(false);

  // If Shift A is removed while two other shifts remain (one current), require an explicit choice.
  setContextCache({
    items: [{ ...shiftB, version: 3, startTime: '07:00', endTime: '15:00', current: true }, shiftC],
    currentLineShiftIds: ['shift-b'],
  });
  await user.click(await screen.findByRole('button', { name: 'Perbarui jadwal' }));
  await waitFor(() => expect(screen.queryByRole('radio', { name: /Shift A/ })).toBeNull());
  expect(radioB().checked).toBe(false);
  expect(screen.getByRole<HTMLInputElement>('radio', { name: /Shift C/ }).checked).toBe(false);
  expect(screen.getByLabelText(/Job/)).toHaveProperty('disabled', true);
  client.clear();
});
