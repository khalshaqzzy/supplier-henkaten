import { expect } from '@playwright/test';

import {
  createHostedFixture,
  get,
  loginBootstrapThroughApi,
  loginRole,
  post,
  realmOriginHeader,
  runtime,
  test,
} from './support.js';

test('proves Man cross-line reservation, donor vacancy, resolution, and realm cookie isolation', async ({
  trackedBrowser: browser,
}) => {
  const tmminContext = await browser.newContext();
  const tmminCsrf = await loginBootstrapThroughApi(tmminContext.request);
  const fixture = await createHostedFixture(
    browser,
    tmminContext.request,
    tmminCsrf,
    'man-concurrency',
  );
  const leader = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.leader.credential!,
    'man-leader',
  );
  const supervisor = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.supervisor.credential!,
    'man-supervisor',
  );
  const donorLeader = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.donorLeader.credential!,
    'man-donor-leader',
  );
  const qc = await loginRole(
    browser,
    fixture.supplier.code,
    fixture.members.qc.credential!,
    'man-qc',
  );
  const businessDate = new Date().toISOString().slice(0, 10);
  const target = await prepareAndStart(
    leader,
    fixture.line.id,
    fixture.shiftTemplate.id,
    businessDate,
    'man-target',
  );
  const donor = await prepareAndStart(
    donorLeader,
    fixture.donorLine.id,
    fixture.shiftTemplate.id,
    businessDate,
    'man-donor',
  );
  const targetAssignment = target.workingAssignments.find(({ jobId }) => jobId === fixture.job.id)!;
  const donorAssignment = donor.workingAssignments.find(
    ({ jobId }) => jobId === fixture.donorJob.id,
  )!;
  expect(targetAssignment.effectiveMpMemberId).toBe(fixture.members.mp.id);
  expect(donorAssignment.effectiveMpMemberId).toBe(fixture.members.replacement.id);

  const movement = manBody({
    fixture,
    shiftRunId: target.id,
    jobId: fixture.job.id,
    target: targetAssignment,
    replacementMpMemberId: fixture.members.replacement.id,
    source: donorAssignment,
  });
  const reservationRace = await Promise.all(
    ['one', 'two'].map((sequence) =>
      leader.context.request.post(`${runtime.apiOrigin}/api/v1/supplier/henkatens`, {
        data: movement,
        headers: {
          ...realmOriginHeader('/api/v1/supplier/henkatens'),
          'X-CSRF-Token': leader.csrf,
          'Idempotency-Key': `e2e-man-reservation-${sequence}`,
        },
      }),
    ),
  );
  const raceStatuses = reservationRace.map((response) => response.status()).sort();
  expect(raceStatuses).toEqual([201, 409]);
  const acceptedResponse = reservationRace.find((response) => response.status() === 201)!;
  const accepted = (await acceptedResponse.json()) as Henkaten;
  const conflict = reservationRace.find((response) => response.status() === 409)!;
  expect((await conflict.json()).code).toBe('RESERVATION_CONFLICT');

  const boardWithReservation = await leader.context.newPage();
  await boardWithReservation.goto(`${runtime.supplierOrigin}/board`);
  await expect(
    boardWithReservation.getByRole('link', {
      name: `MAN OPEN: ${accepted.identifier}`,
    }),
  ).toBeVisible();
  await expect(
    boardWithReservation.getByText(`Reservation aktif · ${accepted.identifier}`),
  ).toBeVisible();
  await boardWithReservation.close();

  const supervisorApproved = await decide(supervisor, accepted, 'APPROVED', 'e2e-man-supervisor');
  const approved = await decide(qc, supervisorApproved, 'APPROVED', 'e2e-man-qc');
  expect(approved.status).toBe('APPROVED');
  expect(approved.man.reservationActive).toBe(false);

  const boardAfterMove = await get<AssignmentBoard>(
    fixture.request,
    '/api/v1/supplier/assignment-board',
  );
  expect(boardAssignment(boardAfterMove, fixture.line.id, fixture.job.id).mp.memberId).toBe(
    fixture.members.replacement.id,
  );
  expect(
    boardAssignment(boardAfterMove, fixture.donorLine.id, fixture.donorJob.id).mp.memberId,
  ).toBeNull();
  const donorAfterMove = (
    await get<Shift>(donorLeader.context.request, `/api/v1/supplier/shifts/${donor.id}`)
  ).workingAssignments.find(({ jobId }) => jobId === fixture.donorJob.id)!;
  const donorIssues = await get<{ items: Array<{ id: string; status: string }> }>(
    donorLeader.context.request,
    `/api/v1/supplier/shifts/${donor.id}/assignment-issues?limit=25`,
  );
  const donorIssue = donorIssues.items.find(({ status }) => status === 'OPEN');
  expect(donorIssue).toBeTruthy();

  await expect
    .poll(
      async () =>
        (
          await get<{ items: Array<{ kind: string }> }>(
            donorLeader.context.request,
            '/api/v1/supplier/notifications?limit=25',
          )
        ).items.length,
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0);

  const resolution = await post<Henkaten>(
    donorLeader.context.request,
    '/api/v1/supplier/henkatens',
    manBody({
      fixture,
      shiftRunId: donor.id,
      jobId: fixture.donorJob.id,
      target: donorAfterMove,
      replacementMpMemberId: fixture.members.mp.id,
      resolutionIssueId: donorIssue!.id,
    }),
    donorLeader.csrf,
    201,
    'e2e-man-resolution',
  );
  const resolutionSupervisor = await decide(
    supervisor,
    resolution,
    'APPROVED',
    'e2e-man-resolution-supervisor',
  );
  const resolved = await decide(qc, resolutionSupervisor, 'APPROVED', 'e2e-man-resolution-qc');
  expect(resolved.status).toBe('APPROVED');
  const boardAfterResolution = await get<AssignmentBoard>(
    fixture.request,
    '/api/v1/supplier/assignment-board',
  );
  const donorResolved = boardAssignment(
    boardAfterResolution,
    fixture.donorLine.id,
    fixture.donorJob.id,
  );
  expect(donorResolved.mp.memberId).toBe(fixture.members.mp.id);
  const resolvedIssues = await get<{ items: Array<{ status: string }> }>(
    donorLeader.context.request,
    `/api/v1/supplier/shifts/${donor.id}/assignment-issues?limit=25`,
  );
  expect(resolvedIssues.items.some(({ status }) => status === 'OPEN')).toBe(false);

  const sharedContext = await browser.newContext();
  const tmminSession = await post<Session>(sharedContext.request, '/api/v1/auth/tmmin/login', {
    username: runtime.bootstrapUsername,
    password: runtime.changedPassword,
  });
  const supplierSession = await post<Session>(
    sharedContext.request,
    '/api/v1/auth/supplier/login',
    {
      supplierCode: fixture.supplier.code,
      username: fixture.admin.username,
      password: fixture.admin.password,
    },
  );
  expect(tmminSession.principal.realm).toBe('TMMIN');
  expect(supplierSession.principal.realm).toBe('SUPPLIER');
  expect(
    (await get<Session>(sharedContext.request, '/api/v1/auth/tmmin/session')).principal.realm,
  ).toBe('TMMIN');
  expect(
    (await get<Session>(sharedContext.request, '/api/v1/auth/supplier/session')).principal.realm,
  ).toBe('SUPPLIER');

  await Promise.all([
    sharedContext.close(),
    fixture.context.close(),
    leader.context.close(),
    donorLeader.context.close(),
    supervisor.context.close(),
    qc.context.close(),
    tmminContext.close(),
  ]);
});

type RoleSession = Awaited<ReturnType<typeof loginRole>>;
type Session = { principal: { realm: string } };
type Assignment = {
  id: string;
  jobId: string;
  version: number;
  effectiveMpMemberId: string | null;
};
type Shift = {
  id: string;
  version: number;
  workingAssignments: Assignment[];
};
type Henkaten = {
  id: string;
  identifier: string;
  version: number;
  status: string;
  man: { reservationActive: boolean };
};
type AssignmentBoard = {
  lines: Array<{
    lineId: string;
    jobs: Array<{ assignmentId: string; jobId: string; mp: { memberId: string | null } }>;
  }>;
};

async function prepareAndStart(
  role: RoleSession,
  lineId: string,
  shiftTemplateId: string,
  businessDate: string,
  key: string,
): Promise<Shift> {
  const prepared = await post<Shift>(
    role.context.request,
    '/api/v1/supplier/shifts/preflight',
    { lineId, shiftTemplateId, businessDate },
    role.csrf,
  );
  return post<Shift>(
    role.context.request,
    `/api/v1/supplier/shifts/${prepared.id}/start`,
    { expectedVersion: prepared.version },
    role.csrf,
    201,
    key,
  );
}

function manBody({
  fixture,
  shiftRunId,
  jobId,
  target,
  replacementMpMemberId,
  source,
  resolutionIssueId,
}: {
  fixture: Awaited<ReturnType<typeof createHostedFixture>>;
  shiftRunId: string;
  jobId: string;
  target: Assignment;
  replacementMpMemberId: string;
  source?: Assignment;
  resolutionIssueId?: string;
}) {
  const checklist = fixture.checklists.MAN!;
  return {
    category: 'MAN',
    shiftRunId,
    jobId,
    partId: fixture.part.id,
    checklistVersionId: checklist.id,
    checklistAnswers: [{ itemId: checklist.itemId, answer: 'YES' }],
    cause: source ? 'Cross-line replacement' : 'Resolve donor vacancy',
    detail: source
      ? 'Move the qualified MP and create an auditable donor vacancy.'
      : 'Resolve the linked donor vacancy with the released MP.',
    targetWorkingAssignmentId: target.id,
    targetAssignmentVersion: target.version,
    replaced: target.effectiveMpMemberId
      ? { kind: 'MP', memberId: target.effectiveMpMemberId }
      : { kind: 'VACANT' },
    replacementMpMemberId,
    ...(source
      ? {
          sourceWorkingAssignmentId: source.id,
          sourceAssignmentVersion: source.version,
        }
      : {}),
    ...(resolutionIssueId ? { resolutionIssueId } : {}),
  };
}

function decide(
  role: RoleSession,
  henkaten: Henkaten,
  decision: 'APPROVED' | 'REJECTED',
  key: string,
) {
  return post<Henkaten>(
    role.context.request,
    `/api/v1/supplier/henkatens/${henkaten.id}/decisions`,
    { expectedVersion: henkaten.version, decision, comment: key },
    role.csrf,
    201,
    key,
  );
}

function boardAssignment(board: AssignmentBoard, lineId: string, jobId: string) {
  const found = board.lines
    .find((line) => line.lineId === lineId)
    ?.jobs.find((job) => job.jobId === jobId);
  if (!found) throw new Error(`Assignment ${lineId}/${jobId} was not present on the Board.`);
  return found;
}
