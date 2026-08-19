import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';

import { boardLayoutDocumentSchema, type BoardLayoutDocument } from '@tmmin-henkaten/contracts';

import { PrismaClient } from '../generated/prisma/client.js';
import {
  LOCAL_SEED_HENKATEN_PER_SUPPLIER,
  LOCAL_SEED_HISTORICAL_SHIFT_COUNT,
  assertLocalSeedEnvironment,
  createLocalSeedPlan,
  localSeedSummary,
  type SeedCategory,
  type SeedHenkatenPlan,
  type SeedOutcome,
  type SupplierSeedPlan,
} from './local-seed-plan.js';
import {
  createLocalSeedCanvasDocument,
  loadLocalSeedPortraits,
  localSeedPortraitIndex,
  type LocalSeedPortrait,
} from './local-seed-visuals.js';

type Credential = { username: string; temporaryPassword: string };
type AccountRecord = {
  role: string;
  displayName: string;
  username: string;
  password: string;
};
type Session = {
  csrfToken: string;
  principal: { role: string; mustChangePassword: boolean };
};
type SessionClient = { api: ApiSession; csrf: string; account: AccountRecord };
type Resource = { id: string; version: number };
type MemberResource = Resource & { fullName?: string };
type ShiftResource = Resource & {
  status: string;
  workingAssignments: AssignmentResource[];
};
type AssignmentResource = {
  id: string;
  jobId: string;
  version: number;
  effectiveMpMemberId: string | null;
};
type HenkatenResource = Resource & {
  status: string;
  clonedFromHenkatenId?: string | null;
};
type SupplierRuntime = {
  plan: SupplierSeedPlan;
  supplier: Resource & { code: string };
  admin: SessionClient;
  supervisors: Array<SessionClient & { memberId: string }>;
  leaders: Array<SessionClient & { memberId: string }>;
  qcs: Array<SessionClient & { memberId: string }>;
  mps: MemberResource[];
  lines: Resource[];
  jobs: Resource[][];
  parts: Resource[];
  shifts: Resource[];
  checklists: Record<SeedCategory, Resource & { itemIds: string[] }>;
};
type Manifest = {
  generatedAt: string;
  portals: { supplier: string; tmmin: string };
  tmmin: AccountRecord[];
  suppliers: Array<{
    code: string;
    name: string;
    accounts: AccountRecord[];
  }>;
};

const apiOrigin = process.env.LOCAL_SEED_API_ORIGIN ?? 'http://127.0.0.1:3000';
const supplierOrigin = process.env.SUPPLIER_APP_ORIGIN ?? 'http://localhost:5173';
const tmminOrigin = process.env.TMMIN_APP_ORIGIN ?? 'http://localhost:5174';
const credentialPath = resolve(
  process.env.LOCAL_SEED_CREDENTIALS_PATH ?? '/workspace/.local/seed-credentials.json',
);
const initialBootstrapUsername = required('TMMIN_BOOTSTRAP_USERNAME');
const initialBootstrapPassword = required('TMMIN_BOOTSTRAP_PASSWORD');
const initialBootstrapDisplayName = required('TMMIN_BOOTSTRAP_DISPLAY_NAME');

class ApiSession {
  private readonly cookies = new Map<string, string>();

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
    csrf?: string,
    expectedStatus = method === 'POST' ? 201 : 200,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Origin: realmOrigin(path),
      ...(this.cookies.size > 0 ? { Cookie: this.cookieHeader() } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    };
    let requestBody: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(`${apiOrigin}${path}`, {
      method,
      headers,
      ...(requestBody ? { body: requestBody } : {}),
    });
    this.captureCookies(response);
    if (response.status !== expectedStatus) {
      throw new Error(
        `${method} ${path} returned ${response.status}, expected ${expectedStatus}: ${await response.text()}`,
      );
    }
    if (expectedStatus === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async uploadPhoto(
    path: string,
    photo: { buffer: Buffer; filename: string; mimeType: 'image/jpeg' | 'image/png' },
    csrf: string,
  ): Promise<void> {
    const form = new FormData();
    form.set('photo', new Blob([photo.buffer], { type: photo.mimeType }), photo.filename);
    const response = await fetch(`${apiOrigin}${path}`, {
      method: 'POST',
      headers: {
        Origin: supplierOrigin,
        Cookie: this.cookieHeader(),
        'X-CSRF-Token': csrf,
      },
      body: form,
    });
    this.captureCookies(response);
    if (response.status !== 201) {
      throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
    }
  }

  private captureCookies(response: Response) {
    const values =
      (
        response.headers as Headers & {
          getSetCookie?: () => string[];
        }
      ).getSetCookie?.() ?? [];
    for (const value of values) {
      const pair = value.split(';', 1)[0]!;
      const separator = pair.indexOf('=');
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }

  private cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

async function main() {
  assertLocalSeedEnvironment(process.env);
  const prisma = createPrisma();
  try {
    await assertEmptySeedTarget(prisma);
    await rm(credentialPath, { force: true });
    const manifest: Manifest = {
      generatedAt: new Date().toISOString(),
      portals: { supplier: supplierOrigin, tmmin: tmminOrigin },
      tmmin: [],
      suppliers: [],
    };
    const tmmin = await prepareTmmin(manifest);
    const portraits = await loadLocalSeedPortraits();
    const runtimes: SupplierRuntime[] = [];
    for (const plan of createLocalSeedPlan()) {
      const runtime = await provisionSupplier(plan, tmmin, manifest, portraits);
      await seedHistorical(runtime);
      await seedLive(runtime);
      await seedCanvasLayouts(runtime);
      runtimes.push(runtime);
    }
    await waitForOutbox(prisma);
    for (const runtime of runtimes) {
      await markOneNotificationRead(runtime);
    }
    await waitForOutbox(prisma);
    await normalizeHistoricalTimeline(prisma);
    await verifySeed(prisma);
    await writeManifest(manifest);
    const summary = localSeedSummary(createLocalSeedPlan());
    process.stdout.write(
      `Local seed complete: 2 Hosted suppliers, ${summary.reduce((total, item) => total + item.henkaten, 0)} Henkaten. Credentials: ${credentialPath}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

function createPrisma() {
  const adapter = new PrismaPg({ connectionString: required('DATABASE_URL') });
  return new PrismaClient({ adapter });
}

async function assertEmptySeedTarget(prisma: PrismaClient) {
  const [suppliers, externalClients, projections, nonBootstrapUsers] = await Promise.all([
    prisma.supplier.count(),
    prisma.externalApiClient.count(),
    prisma.externalHenkatenProjection.count(),
    prisma.user.count({ where: { protectedBootstrapAdmin: false } }),
  ]);
  if (suppliers !== 0 || externalClients !== 0 || projections !== 0 || nonBootstrapUsers !== 0) {
    throw new Error(
      'Local seed target is not empty bootstrap-only state; refusing to append data.',
    );
  }
  const bootstrap = await prisma.user.count({
    where: { protectedBootstrapAdmin: true, realm: 'TMMIN', role: 'TMMIN_ADMIN' },
  });
  if (bootstrap !== 1) {
    throw new Error('Local seed requires exactly one protected TMMIN bootstrap administrator.');
  }
}

async function prepareTmmin(manifest: Manifest): Promise<SessionClient> {
  const api = new ApiSession();
  const initial = await api.request<Session>(
    'POST',
    '/api/v1/auth/tmmin/login',
    {
      username: initialBootstrapUsername,
      password: initialBootstrapPassword,
    },
    undefined,
    200,
  );
  const password = securePassword();
  await api.request(
    'POST',
    '/api/v1/auth/tmmin/change-password',
    { currentPassword: initialBootstrapPassword, newPassword: password },
    initial.csrfToken,
    204,
  );
  const session = await api.request<Session>(
    'POST',
    '/api/v1/auth/tmmin/login',
    {
      username: initialBootstrapUsername,
      password,
    },
    undefined,
    200,
  );
  const admin = {
    role: 'TMMIN_ADMIN',
    displayName: initialBootstrapDisplayName,
    username: initialBootstrapUsername,
    password,
  };
  manifest.tmmin.push(admin);

  const qualityCreated = await api.request<{ credential: Credential }>(
    'POST',
    '/api/v1/tmmin/quality-users',
    { username: 'quality.local', displayName: 'Quality Monitoring Lokal' },
    session.csrfToken,
  );
  const quality = await activateCredential(
    'tmmin',
    qualityCreated.credential,
    'TMMIN_QUALITY',
    'Quality Monitoring Lokal',
  );
  manifest.tmmin.push(quality.account);
  return { api, csrf: session.csrfToken, account: admin };
}

async function provisionSupplier(
  plan: SupplierSeedPlan,
  tmmin: SessionClient,
  manifest: Manifest,
  portraits: LocalSeedPortrait[],
): Promise<SupplierRuntime> {
  const created = await tmmin.api.request<{
    supplier: Resource & { code: string };
    credential: Credential;
  }>(
    'POST',
    '/api/v1/tmmin/suppliers',
    {
      code: plan.code,
      name: plan.name,
      timezone: 'Asia/Jakarta',
      sourceMode: 'HOSTED',
      supplierAdmin: {
        username: 'supplier.admin',
        displayName: `Admin ${plan.code}`,
      },
    },
    tmmin.csrf,
  );
  const admin = await activateCredential(
    'supplier',
    created.credential,
    'SUPPLIER_ADMIN',
    `Admin ${plan.code}`,
    plan.code,
  );
  const accounts = [admin.account];
  const lines: Resource[] = [];
  const jobs: Resource[][] = [];
  for (let lineIndex = 0; lineIndex < 3; lineIndex += 1) {
    const line = await admin.api.request<Resource>(
      'POST',
      '/api/v1/supplier/master-data/lines',
      {
        code: `${plan.code}-L${lineIndex + 1}`,
        name: plan.lineNames[lineIndex],
      },
      admin.csrf,
    );
    lines.push(line);
    const lineJobs: Resource[] = [];
    for (let jobIndex = 0; jobIndex < 4; jobIndex += 1) {
      lineJobs.push(
        await admin.api.request<Resource>(
          'POST',
          `/api/v1/supplier/master-data/lines/${line.id}/jobs`,
          { name: plan.jobNames[lineIndex]![jobIndex]! },
          admin.csrf,
        ),
      );
    }
    jobs.push(lineJobs);
  }
  const parts: Resource[] = [];
  for (let index = 0; index < 8; index += 1) {
    parts.push(
      await admin.api.request<Resource>(
        'POST',
        '/api/v1/supplier/master-data/parts',
        {
          partNumber: plan.parts[index]!.number,
          partName: plan.parts[index]!.name,
        },
        admin.csrf,
      ),
    );
  }
  const shifts: Resource[] = [];
  for (const [name, startTime, endTime] of [
    ['Shift Pagi', '06:00', '14:00'],
    ['Shift Sore', '14:00', '22:00'],
    ['Shift Malam', '22:00', '06:00'],
  ]) {
    shifts.push(
      await admin.api.request<Resource>(
        'POST',
        '/api/v1/supplier/master-data/shift-templates',
        { name, startTime, endTime, timezone: 'Asia/Jakarta' },
        admin.csrf,
      ),
    );
  }
  const supervisors = await createRoleMembers(admin, plan.code, 'SUPERVISOR', 2, accounts);
  const leaders = await createRoleMembers(admin, plan.code, 'LINE_LEADER', 3, accounts);
  const qcs = await createRoleMembers(admin, plan.code, 'QC', 2, accounts);
  const mps: MemberResource[] = [];
  for (let index = 0; index < 15; index += 1) {
    const response = await admin.api.request<{ member: MemberResource }>(
      'POST',
      '/api/v1/supplier/master-data/members',
      {
        fullName: `Operator Sintetis ${plan.code} ${index + 1}`,
        registrationNumber: `SYN-${plan.code}-MP-${String(index + 1).padStart(3, '0')}`,
        role: 'MP',
      },
      admin.csrf,
    );
    mps.push(response.member);
  }
  const checklists = {} as SupplierRuntime['checklists'];
  const checklistLabels = {
    MAN: [
      'Kualifikasi operator pengganti sesuai proses',
      'Handover poin kualitas kritis telah dilakukan',
      'Instruksi kerja dipahami operator pengganti',
      'Monitoring awal oleh leader telah ditetapkan',
    ],
    MACHINE: [
      'Parameter setup sesuai standard condition',
      'Status kalibrasi alat masih berlaku',
      'First-piece check telah dikonfirmasi',
      'Safety interlock berfungsi normal',
    ],
    MATERIAL: [
      'Nomor lot dan traceability dapat diverifikasi',
      'Spesifikasi dan certificate sesuai',
      'FIFO serta masa simpan telah diperiksa',
      'Sampel awal memenuhi acceptance criteria',
    ],
    METHOD: [
      'Revisi instruksi kerja tersedia di area',
      'Perubahan telah dijelaskan kepada operator',
      'Key control point tetap teridentifikasi',
      'Hasil siklus awal telah divalidasi',
    ],
  } as const;
  for (const category of ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const) {
    const draft = await admin.api.request<Resource>(
      'PATCH',
      `/api/v1/supplier/master-data/checklists/${category}/draft`,
      {
        items: checklistLabels[category].map((label) => ({ label })),
      },
      admin.csrf,
    );
    const published = await admin.api.request<Resource & { items: Resource[] }>(
      'POST',
      `/api/v1/supplier/master-data/checklists/${category}/publish`,
      { expectedVersion: draft.version },
      admin.csrf,
    );
    checklists[category] = {
      id: published.id,
      version: published.version,
      itemIds: published.items.map(({ id }) => id),
    };
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    await admin.api.request(
      'POST',
      `/api/v1/supplier/master-data/lines/${lines[lineIndex]!.id}/default-supervisor`,
      { memberId: supervisors[lineIndex % supervisors.length]!.memberId },
      admin.csrf,
    );
    await admin.api.request(
      'POST',
      `/api/v1/supplier/master-data/lines/${lines[lineIndex]!.id}/default-line-leader`,
      { memberId: leaders[lineIndex]!.memberId },
      admin.csrf,
    );
    for (let jobIndex = 0; jobIndex < jobs[lineIndex]!.length; jobIndex += 1) {
      if (lineIndex === 0 && jobIndex === 0) continue;
      await assignDefaultMp(admin, jobs[lineIndex]![jobIndex]!, mps[lineIndex * 4 + jobIndex]!);
    }
  }
  const rolePhotoMemberIds = [
    ...supervisors.map(({ memberId }) => memberId),
    ...leaders.map(({ memberId }) => memberId),
    ...qcs.map(({ memberId }) => memberId),
  ];
  for (const memberId of rolePhotoMemberIds) {
    const photo = await syntheticAvatar(plan.accent);
    await admin.api.uploadPhoto(
      `/api/v1/supplier/master-data/members/${memberId}/photo`,
      { buffer: photo, filename: 'synthetic-avatar.png', mimeType: 'image/png' },
      admin.csrf,
    );
  }
  for (let mpIndex = 0; mpIndex < 12; mpIndex += 1) {
    const portrait = portraits[localSeedPortraitIndex(mpIndex)];
    if (!portrait) throw new Error('Local seed portrait catalog is incomplete.');
    await admin.api.uploadPhoto(
      `/api/v1/supplier/master-data/members/${mps[mpIndex]!.id}/photo`,
      portrait,
      admin.csrf,
    );
  }
  manifest.suppliers.push({ code: plan.code, name: plan.name, accounts });
  return {
    plan,
    supplier: created.supplier,
    admin,
    supervisors,
    leaders,
    qcs,
    mps,
    lines,
    jobs,
    parts,
    shifts,
    checklists,
  };
}

async function createRoleMembers(
  admin: SessionClient,
  code: string,
  role: 'SUPERVISOR' | 'LINE_LEADER' | 'QC',
  count: number,
  accounts: AccountRecord[],
) {
  const result: Array<SessionClient & { memberId: string; id: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const displayName = `${role.replace('_', ' ')} ${code} ${index + 1}`;
    const created = await admin.api.request<{
      member: MemberResource;
      credential: Credential;
    }>(
      'POST',
      '/api/v1/supplier/master-data/members',
      {
        fullName: displayName,
        registrationNumber: `SYN-${code}-${role}-${index + 1}`,
        role,
        username: `${role.toLowerCase().replace('_', '.')}.${index + 1}`,
      },
      admin.csrf,
    );
    const active = await activateCredential(
      'supplier',
      created.credential,
      role,
      displayName,
      code,
    );
    accounts.push(active.account);
    result.push({ ...active, memberId: created.member.id, id: created.member.id });
  }
  return result;
}

async function activateCredential(
  realm: 'tmmin' | 'supplier',
  credential: Credential,
  role: string,
  displayName: string,
  supplierCode?: string,
): Promise<SessionClient> {
  const api = new ApiSession();
  const loginPath = `/api/v1/auth/${realm}/login`;
  const initial = await api.request<Session>(
    'POST',
    loginPath,
    {
      ...(supplierCode ? { supplierCode } : {}),
      username: credential.username,
      password: credential.temporaryPassword,
    },
    undefined,
    200,
  );
  const password = securePassword();
  await api.request(
    'POST',
    `/api/v1/auth/${realm}/change-password`,
    { currentPassword: credential.temporaryPassword, newPassword: password },
    initial.csrfToken,
    204,
  );
  const session = await api.request<Session>(
    'POST',
    loginPath,
    {
      ...(supplierCode ? { supplierCode } : {}),
      username: credential.username,
      password,
    },
    undefined,
    200,
  );
  return {
    api,
    csrf: session.csrfToken,
    account: { role, displayName, username: credential.username, password },
  };
}

async function seedHistorical(runtime: SupplierRuntime) {
  let pendingClone: string | undefined;
  for (let group = 0; group < LOCAL_SEED_HISTORICAL_SHIFT_COUNT; group += 1) {
    const records = runtime.plan.historical.filter(
      ({ historicalShiftIndex }) => historicalShiftIndex === group,
    );
    if (records.length === 0) {
      throw new Error(`Historical shift ${group} has no planned Henkaten.`);
    }
    const lineIndex = records[0]!.lineIndex!;
    const leader = runtime.leaders[lineIndex]!;
    const date = jakartaDate(records[0]!.historicalDayOffset!);
    let shift = await leader.api.request<ShiftResource>(
      'POST',
      '/api/v1/supplier/shifts/preflight',
      {
        lineId: runtime.lines[lineIndex]!.id,
        shiftTemplateId: runtime.shifts[records[0]!.shiftTemplateIndex!]!.id,
        businessDate: date,
      },
      leader.csrf,
    );
    if (group === 0) {
      shift = await runtime.admin.api.request<ShiftResource>(
        'POST',
        `/api/v1/supplier/shifts/${shift.id}/emergency-start`,
        {
          expectedVersion: shift.version,
          reason: 'Shift dimulai untuk recovery produksi setelah keterlambatan serah terima.',
        },
        runtime.admin.csrf,
      );
      await assignDefaultMp(runtime.admin, runtime.jobs[lineIndex]![0]!, runtime.mps[0]!);
    } else {
      shift = await leader.api.request<ShiftResource>(
        'POST',
        `/api/v1/supplier/shifts/${shift.id}/start`,
        { expectedVersion: shift.version },
        leader.csrf,
        201,
        `local-historical-start-${runtime.plan.code}-${group}`,
      );
    }
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      const created = await createHenkaten(
        runtime,
        shift,
        lineIndex,
        record,
        `historical-${group}-${index}-m${record.eventMinuteOffset}-d${record.resolutionMinuteDelay}`,
        pendingClone,
      );
      pendingClone = undefined;
      if (record.outcome === 'CANCELLED_WITHDRAWN' && !pendingClone) {
        pendingClone = created.id;
      }
      await applyOutcome(runtime, lineIndex, created, record.outcome, leader);
    }
    const latest = await leader.api.request<ShiftResource>(
      'GET',
      `/api/v1/supplier/shifts/${shift.id}`,
      undefined,
      undefined,
      200,
    );
    await leader.api.request(
      'POST',
      `/api/v1/supplier/shifts/${shift.id}/end`,
      { expectedVersion: latest.version },
      leader.csrf,
      201,
      `local-historical-end-${runtime.plan.code}-${group}`,
    );
  }
}

async function seedLive(runtime: SupplierRuntime) {
  const liveShifts: ShiftResource[] = [];
  for (let lineIndex = 0; lineIndex < 3; lineIndex += 1) {
    const leader = runtime.leaders[lineIndex]!;
    const prepared = await leader.api.request<ShiftResource>(
      'POST',
      '/api/v1/supplier/shifts/preflight',
      {
        lineId: runtime.lines[lineIndex]!.id,
        shiftTemplateId: runtime.shifts[lineIndex]!.id,
        businessDate: jakartaDate(0),
      },
      leader.csrf,
    );
    liveShifts.push(
      await leader.api.request<ShiftResource>(
        'POST',
        `/api/v1/supplier/shifts/${prepared.id}/start`,
        { expectedVersion: prepared.version },
        leader.csrf,
        201,
        `local-live-start-${runtime.plan.code}-${lineIndex}`,
      ),
    );
  }

  const firstMovement = await createCrossLineMan(
    runtime,
    liveShifts[0]!,
    liveShifts[1]!,
    0,
    1,
    0,
    'live-movement-resolved-source',
  );
  const afterSupervisor = await decide(
    runtime.supervisors[0]!,
    firstMovement,
    'APPROVED',
    `${runtime.plan.code}-live-move-1-supervisor`,
  );
  const moved = await decide(
    runtime.qcs[0]!,
    afterSupervisor,
    'APPROVED',
    `${runtime.plan.code}-live-move-1-qc`,
  );
  const donorShift = await runtime.leaders[1]!.api.request<ShiftResource>(
    'GET',
    `/api/v1/supplier/shifts/${liveShifts[1]!.id}`,
    undefined,
    undefined,
    200,
  );
  const issues = await runtime.leaders[1]!.api.request<{
    items: Array<Resource & { status: string }>;
  }>(
    'GET',
    `/api/v1/supplier/shifts/${donorShift.id}/assignment-issues?limit=25`,
    undefined,
    undefined,
    200,
  );
  const issue = issues.items.find(({ status }) => status === 'OPEN');
  if (!issue) throw new Error('Expected a donor vacancy after the first live movement.');
  const resolutionTarget = donorShift.workingAssignments.find(
    ({ jobId }) => jobId === runtime.jobs[1]![0]!.id,
  )!;
  const resolution = await createManHenkaten(
    runtime,
    donorShift,
    1,
    resolutionTarget,
    runtime.mps[0]!.id,
    'live-resolution',
    undefined,
    issue.id,
  );
  const resolutionQc = await decide(
    runtime.qcs[0]!,
    resolution,
    'APPROVED',
    `${runtime.plan.code}-live-resolution-qc`,
  );
  await decide(
    runtime.supervisors[1]!,
    resolutionQc,
    'APPROVED',
    `${runtime.plan.code}-live-resolution-supervisor`,
  );
  const secondMovement = await createCrossLineMan(
    runtime,
    liveShifts[2]!,
    liveShifts[0]!,
    2,
    0,
    1,
    'live-movement-unresolved',
  );
  const secondSupervisor = await decide(
    runtime.supervisors[0]!,
    secondMovement,
    'APPROVED',
    `${runtime.plan.code}-live-move-2-supervisor`,
  );
  await decide(
    runtime.qcs[1]!,
    secondSupervisor,
    'APPROVED',
    `${runtime.plan.code}-live-move-2-qc`,
  );
  const refreshedThird = await runtime.leaders[2]!.api.request<ShiftResource>(
    'GET',
    `/api/v1/supplier/shifts/${liveShifts[2]!.id}`,
    undefined,
    undefined,
    200,
  );
  const openTarget = refreshedThird.workingAssignments.find(
    ({ jobId }) => jobId === runtime.jobs[2]![2]!.id,
  )!;
  const openMan = await createManHenkaten(
    runtime,
    refreshedThird,
    2,
    openTarget,
    runtime.mps[14]!.id,
    'live-open-reservation',
  );
  await decide(
    runtime.supervisors[0]!,
    openMan,
    'APPROVED',
    `${runtime.plan.code}-live-open-man-supervisor`,
  );

  const nonManPlans = runtime.plan.live.filter(({ category }) => category !== 'MAN');
  for (let index = 0; index < nonManPlans.length; index += 1) {
    const lineIndex = index % 3;
    const leader = runtime.leaders[lineIndex]!;
    const latest = await leader.api.request<ShiftResource>(
      'GET',
      `/api/v1/supplier/shifts/${liveShifts[lineIndex]!.id}`,
      undefined,
      undefined,
      200,
    );
    const record = nonManPlans[index]!;
    const created = await createHenkaten(runtime, latest, lineIndex, record, `live-${index}`);
    await applyOutcome(runtime, lineIndex, created, record.outcome, leader);
  }
  void moved;
}

async function seedCanvasLayouts(runtime: SupplierRuntime) {
  for (let lineIndex = 0; lineIndex < runtime.lines.length; lineIndex += 1) {
    const document = createLocalSeedCanvasDocument(
      runtime.plan,
      lineIndex,
      runtime.jobs[lineIndex]!,
    );
    await runtime.admin.api.request<{ document: BoardLayoutDocument; version: number }>(
      'PUT',
      `/api/v1/supplier/assignment-board/layouts/${runtime.lines[lineIndex]!.id}`,
      { expectedVersion: null, document },
      runtime.admin.csrf,
      200,
    );
  }
}

async function createCrossLineMan(
  runtime: SupplierRuntime,
  targetShift: ShiftResource,
  sourceShift: ShiftResource,
  targetLineIndex: number,
  sourceLineIndex: number,
  jobIndex: number,
  key: string,
) {
  const [targetLatest, sourceLatest] = await Promise.all([
    runtime.leaders[targetLineIndex]!.api.request<ShiftResource>(
      'GET',
      `/api/v1/supplier/shifts/${targetShift.id}`,
      undefined,
      undefined,
      200,
    ),
    runtime.leaders[sourceLineIndex]!.api.request<ShiftResource>(
      'GET',
      `/api/v1/supplier/shifts/${sourceShift.id}`,
      undefined,
      undefined,
      200,
    ),
  ]);
  const target = targetLatest.workingAssignments.find(
    ({ jobId }) => jobId === runtime.jobs[targetLineIndex]![jobIndex]!.id,
  )!;
  const source = sourceLatest.workingAssignments.find(
    ({ jobId }) => jobId === runtime.jobs[sourceLineIndex]![jobIndex]!.id,
  )!;
  return createManHenkaten(
    runtime,
    targetLatest,
    targetLineIndex,
    target,
    source.effectiveMpMemberId!,
    key,
    source,
  );
}

async function createHenkaten(
  runtime: SupplierRuntime,
  shift: ShiftResource,
  lineIndex: number,
  record: SeedHenkatenPlan,
  key: string,
  clonedFromHenkatenId?: string,
) {
  if (record.category === 'MAN') {
    const latest = await runtime.leaders[lineIndex]!.api.request<ShiftResource>(
      'GET',
      `/api/v1/supplier/shifts/${shift.id}`,
      undefined,
      undefined,
      200,
    );
    const plannedJob = runtime.jobs[lineIndex]![record.jobIndex ?? key.length % 4]!;
    const target =
      latest.workingAssignments.find(({ jobId }) => jobId === plannedJob.id) ??
      latest.workingAssignments[0]!;
    const activeIds = new Set(
      latest.workingAssignments
        .map(({ effectiveMpMemberId }) => effectiveMpMemberId)
        .filter((id): id is string => Boolean(id)),
    );
    const replacement = runtime.mps.find(({ id }) => !activeIds.has(id));
    if (!replacement) throw new Error('No free synthetic MP was available for Man Henkaten.');
    return createManHenkaten(
      runtime,
      latest,
      lineIndex,
      target,
      replacement.id,
      key,
      undefined,
      undefined,
      clonedFromHenkatenId,
      record,
    );
  }
  const checklist = runtime.checklists[record.category];
  const narrative = henkatenNarrative(record.category, record.narrativeVariant ?? key.length);
  return runtime.leaders[lineIndex]!.api.request<HenkatenResource>(
    'POST',
    '/api/v1/supplier/henkatens',
    {
      category: record.category,
      shiftRunId: shift.id,
      jobId: runtime.jobs[lineIndex]![record.jobIndex ?? key.length % 4]!.id,
      partId: runtime.parts[record.partIndex ?? key.length % runtime.parts.length]!.id,
      checklistVersionId: checklist.id,
      checklistAnswers: plannedChecklistAnswers(checklist.itemIds),
      cause: narrative.cause,
      detail: narrative.detail,
      affectedObject: narrative.affectedObject ?? 'Kondisi proses sebelum perubahan',
      replacementObject: narrative.replacementObject ?? 'Kondisi proses setelah perubahan',
      ...(clonedFromHenkatenId ? { clonedFromHenkatenId } : {}),
    },
    runtime.leaders[lineIndex]!.csrf,
    201,
    `local-${runtime.plan.code}-${key}`,
  );
}

async function createManHenkaten(
  runtime: SupplierRuntime,
  shift: ShiftResource,
  lineIndex: number,
  target: AssignmentResource,
  replacementMpMemberId: string,
  key: string,
  source?: AssignmentResource,
  resolutionIssueId?: string,
  clonedFromHenkatenId?: string,
  record?: SeedHenkatenPlan,
) {
  const checklist = runtime.checklists.MAN;
  const narrative = henkatenNarrative('MAN', record?.narrativeVariant ?? key.length);
  return runtime.leaders[lineIndex]!.api.request<HenkatenResource>(
    'POST',
    '/api/v1/supplier/henkatens',
    {
      category: 'MAN',
      shiftRunId: shift.id,
      jobId: target.jobId,
      partId: runtime.parts[record?.partIndex ?? key.length % runtime.parts.length]!.id,
      checklistVersionId: checklist.id,
      checklistAnswers: plannedChecklistAnswers(checklist.itemIds),
      cause: resolutionIssueId ? 'Pengisian vacancy akibat perpindahan operator' : narrative.cause,
      detail: resolutionIssueId
        ? 'Operator pengganti dialokasikan setelah verifikasi kompetensi dan handover titik kontrol.'
        : narrative.detail,
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
      ...(clonedFromHenkatenId ? { clonedFromHenkatenId } : {}),
    },
    runtime.leaders[lineIndex]!.csrf,
    201,
    `local-${runtime.plan.code}-${key}`,
  );
}

function plannedChecklistAnswers(itemIds: string[]) {
  return itemIds.map((itemId) => ({
    itemId,
    answer: 'YES' as const,
  }));
}

function henkatenNarrative(
  category: SeedCategory,
  variant: number,
): {
  cause: string;
  detail: string;
  affectedObject?: string;
  replacementObject?: string;
} {
  const narratives = {
    MAN: [
      {
        cause: 'Rotasi operator untuk pemerataan kompetensi proses',
        detail:
          'Operator pengganti menjalani handover titik kualitas kritis sebelum mengambil posisi.',
      },
      {
        cause: 'Penggantian operator pada jam istirahat bergilir',
        detail: 'Relief operator ditempatkan dengan monitoring awal oleh line leader.',
      },
      {
        cause: 'Penyesuaian manpower akibat kebutuhan proses bottleneck',
        detail:
          'Operator dialihkan sementara setelah kompetensi proses dan beban line diverifikasi.',
      },
      {
        cause: 'Operator utama tidak tersedia pada awal shift',
        detail: 'Operator cadangan mengambil assignment sesuai matriks otorisasi lokal.',
      },
      {
        cause: 'Cross-training operator pada proses berisiko rendah',
        detail: 'Pelaksanaan didampingi leader dengan pengecekan hasil unit pertama.',
      },
    ],
    MACHINE: [
      {
        cause: 'Pergantian dies setelah preventive maintenance',
        detail: 'Parameter press dan hasil panel pertama diperiksa sebelum produksi dilanjutkan.',
        affectedObject: 'Dies produksi sebelum preventive maintenance',
        replacementObject: 'Dies produksi setelah setting dan first-piece approval',
      },
      {
        cause: 'Penggantian torque tool karena jadwal kalibrasi',
        detail: 'Tool pengganti diverifikasi terhadap master torque dan status kalibrasinya.',
        affectedObject: 'Torque tool mendekati batas kalibrasi',
        replacementObject: 'Torque tool terkalibrasi dengan setting tervalidasi',
      },
      {
        cause: 'Penggantian locator jig karena keausan',
        detail: 'Dimensi referensi jig dan sampel awal dikonfirmasi oleh produksi dan QC.',
        affectedObject: 'Locator jig dengan indikasi wear',
        replacementObject: 'Locator jig baru setelah dimensional check',
      },
      {
        cause: 'Pergantian welding tip berdasarkan counter',
        detail: 'Arus, tekanan, dan hasil peel test diperiksa sebelum release.',
        affectedObject: 'Welding tip mencapai batas pemakaian',
        replacementObject: 'Welding tip baru dengan parameter standar',
      },
      {
        cause: 'Restart mesin setelah minor breakdown',
        detail: 'Recovery dilakukan tanpa perubahan program dan disertai verifikasi first piece.',
        affectedObject: 'Mesin berhenti akibat sensor interlock',
        replacementObject: 'Mesin normal setelah sensor disetel ulang',
      },
    ],
    MATERIAL: [
      {
        cause: 'Pergantian lot steel coil sesuai urutan FIFO',
        detail: 'Heat number, ketebalan, dan sertifikat material lot baru telah diverifikasi.',
        affectedObject: 'Lot steel coil produksi sebelumnya',
        replacementObject: 'Lot steel coil berikutnya dengan heat number berbeda',
      },
      {
        cause: 'Pergantian lot resin pada material dryer',
        detail: 'Nomor lot, moisture reading, dan parameter drying dikonfirmasi sebelum molding.',
        affectedObject: 'Lot resin yang selesai digunakan',
        replacementObject: 'Lot resin baru setelah moisture check',
      },
      {
        cause: 'Penggunaan batch sub-component berikutnya',
        detail: 'Label traceability dan hasil incoming inspection batch baru telah diperiksa.',
        affectedObject: 'Batch sub-component sebelumnya',
        replacementObject: 'Batch sub-component baru dari delivery berikutnya',
      },
      {
        cause: 'Pergantian kemasan returnable karena kondisi abnormal',
        detail: 'Kemasan pengganti dibersihkan dan diverifikasi bebas kontaminasi.',
        affectedObject: 'Returnable box dengan kerusakan ringan',
        replacementObject: 'Returnable box pengganti yang telah diperiksa',
      },
      {
        cause: 'Material alternatif sesuai temporary deviation',
        detail: 'Dokumen deviasi, identifikasi lot, dan batas penggunaannya dikonfirmasi.',
        affectedObject: 'Material standar pada bill of material',
        replacementObject: 'Material alternatif dalam batas deviasi terkontrol',
      },
    ],
    METHOD: [
      {
        cause: 'Revisi urutan kerja untuk mengurangi handling',
        detail: 'Urutan baru disosialisasikan dan hasil siklus pertama divalidasi oleh leader.',
        affectedObject: 'Urutan kerja sebelum improvement',
        replacementObject: 'Urutan kerja revisi dengan handling lebih singkat',
      },
      {
        cause: 'Penyesuaian urutan pengencangan bolt',
        detail: 'Sequence dan nilai torque dikonfirmasi terhadap instruksi kerja terbaru.',
        affectedObject: 'Sequence pengencangan versi sebelumnya',
        replacementObject: 'Sequence silang sesuai revisi instruksi kerja',
      },
      {
        cause: 'Peningkatan frekuensi inspeksi sementara',
        detail: 'Sampling ditingkatkan setelah tren minor defect pada shift sebelumnya.',
        affectedObject: 'Frekuensi inspeksi normal',
        replacementObject: 'Temporary tightened inspection',
      },
      {
        cause: 'Penerapan temporary work instruction untuk rework',
        detail: 'Batas lot, metode rework, dan acceptance criteria telah dijelaskan.',
        affectedObject: 'Proses standar tanpa aktivitas rework',
        replacementObject: 'Temporary rework method yang disetujui',
      },
      {
        cause: 'Perubahan metode pemeriksaan visual',
        detail: 'Sudut pencahayaan dan boundary sample diperbarui pada area inspeksi.',
        affectedObject: 'Metode visual check dengan pencahayaan umum',
        replacementObject: 'Metode visual check memakai focused lighting',
      },
    ],
  } as const;
  return narratives[category][variant % narratives[category].length]!;
}

async function applyOutcome(
  runtime: SupplierRuntime,
  lineIndex: number,
  henkaten: HenkatenResource,
  outcome: SeedOutcome,
  leader: SessionClient,
) {
  const supervisor = runtime.supervisors[lineIndex % runtime.supervisors.length]!;
  const qc = runtime.qcs[lineIndex % runtime.qcs.length]!;
  if (outcome === 'APPROVED_SUPERVISOR_FIRST') {
    const first = await decide(
      supervisor,
      henkaten,
      'APPROVED',
      `${runtime.plan.code}-${henkaten.id}-supervisor`,
    );
    await decide(qc, first, 'APPROVED', `${runtime.plan.code}-${henkaten.id}-qc`);
  } else if (outcome === 'APPROVED_QC_FIRST') {
    const first = await decide(qc, henkaten, 'APPROVED', `${runtime.plan.code}-${henkaten.id}-qc`);
    await decide(supervisor, first, 'APPROVED', `${runtime.plan.code}-${henkaten.id}-supervisor`);
  } else if (outcome === 'REJECTED_SUPERVISOR') {
    await decide(
      supervisor,
      henkaten,
      'REJECTED',
      `${runtime.plan.code}-${henkaten.id}-supervisor-reject`,
    );
  } else if (outcome === 'REJECTED_QC') {
    await decide(qc, henkaten, 'REJECTED', `${runtime.plan.code}-${henkaten.id}-qc-reject`);
  } else if (outcome === 'CANCELLED_WITHDRAWN') {
    await leader.api.request(
      'POST',
      `/api/v1/supplier/henkatens/${henkaten.id}/withdraw`,
      {
        expectedVersion: henkaten.version,
        reason: 'Data objek perubahan perlu dikoreksi sebelum diajukan kembali.',
      },
      leader.csrf,
      201,
      `${runtime.plan.code}-${henkaten.id}-withdraw`,
    );
  } else if (outcome === 'OPEN_SUPERVISOR_APPROVED') {
    await decide(
      supervisor,
      henkaten,
      'APPROVED',
      `${runtime.plan.code}-${henkaten.id}-supervisor-open`,
    );
  } else if (outcome === 'OPEN_QC_APPROVED') {
    await decide(qc, henkaten, 'APPROVED', `${runtime.plan.code}-${henkaten.id}-qc-open`);
  }
}

function decide(
  role: SessionClient,
  henkaten: HenkatenResource,
  decision: 'APPROVED' | 'REJECTED',
  key: string,
) {
  return role.api.request<HenkatenResource>(
    'POST',
    `/api/v1/supplier/henkatens/${henkaten.id}/decisions`,
    {
      expectedVersion: henkaten.version,
      decision,
      comment:
        decision === 'APPROVED'
          ? 'Poin kontrol telah diverifikasi dan perubahan dapat dijalankan.'
          : 'Checklist belum memenuhi acceptance criteria; lakukan koreksi sebelum pengajuan ulang.',
    },
    role.csrf,
    201,
    key,
  );
}

async function assignDefaultMp(admin: SessionClient, job: Resource, mp: MemberResource) {
  await admin.api.request(
    'POST',
    `/api/v1/supplier/master-data/jobs/${job.id}/default-mp`,
    { memberId: mp.id },
    admin.csrf,
  );
}

async function markOneNotificationRead(runtime: SupplierRuntime) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await runtime.qcs[0]!.api.request<{
      items: Array<Resource & { read: boolean }>;
    }>('GET', '/api/v1/supplier/notifications?limit=25', undefined, undefined, 200);
    const unread = response.items.find(({ read }) => !read);
    if (unread) {
      await runtime.qcs[0]!.api.request(
        'PATCH',
        `/api/v1/supplier/notifications/${unread.id}/read-state`,
        { read: true, expectedVersion: unread.version },
        runtime.qcs[0]!.csrf,
      );
      return;
    }
    await delay(250);
  }
  throw new Error(`No notification became available for ${runtime.plan.code}.`);
}

async function waitForOutbox(prisma: PrismaClient) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const pending = await prisma.outboxEvent.count({
      where: { processedAt: null, failedAt: null },
    });
    if (pending === 0) return;
    await delay(250);
  }
  throw new Error('Transactional outbox did not drain before local seed verification.');
}

async function normalizeHistoricalTimeline(prisma: PrismaClient) {
  await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
    prisma.$executeRaw`
      UPDATE "ShiftRun"
      SET "startedAt" = "scheduledStartAt"
            + (2 + EXTRACT(DAY FROM "businessDate")::int % 6) * interval '1 minute',
          "endedAt" = "scheduledEndAt"
            - (1 + EXTRACT(DAY FROM "businessDate")::int % 9) * interval '1 minute',
          "createdAt" = "scheduledStartAt"
            - (6 + EXTRACT(DAY FROM "businessDate")::int % 11) * interval '1 minute',
          "updatedAt" = "scheduledEndAt" - interval '2 minutes',
          "latestPreflightAt" = "scheduledStartAt"
            - (3 + EXTRACT(DAY FROM "businessDate")::int % 7) * interval '1 minute'
      WHERE status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "Henkaten" h
      SET "occurredAt" = s."scheduledStartAt"
              + substring(h."submissionKey" from '-m([0-9]+)-d')::int * interval '1 minute',
          "createdAt" = s."scheduledStartAt"
              + substring(h."submissionKey" from '-m([0-9]+)-d')::int * interval '1 minute',
          "updatedAt" = CASE WHEN h.status = 'OPEN' THEN h."updatedAt"
                            ELSE s."scheduledStartAt"
                              + (
                                  substring(h."submissionKey" from '-m([0-9]+)-d')::int
                                  + substring(h."submissionKey" from '-d([0-9]+)$')::int
                                ) * interval '1 minute' END,
          "finalizedAt" = CASE WHEN h.status = 'OPEN' THEN NULL
                              ELSE s."scheduledStartAt"
                                + (
                                    substring(h."submissionKey" from '-m([0-9]+)-d')::int
                                    + substring(h."submissionKey" from '-d([0-9]+)$')::int
                                  ) * interval '1 minute' END
      FROM "ShiftRun" s
      WHERE h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "HenkatenApprovalRoute" r
      SET "createdAt" = h."occurredAt", "updatedAt" = COALESCE(h."finalizedAt", h."occurredAt")
      FROM "Henkaten" h, "ShiftRun" s
      WHERE r."henkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "ApprovalDecision" d
      SET "decidedAt" = h."occurredAt" + (8 + d."resultHenkatenVersion" * 5) * interval '1 minute'
      FROM "Henkaten" h, "ShiftRun" s
      WHERE d."henkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "HenkatenTransition" t SET "occurredAt" =
        CASE WHEN t."fromStatus" IS NULL THEN h."occurredAt"
             ELSE COALESCE(h."finalizedAt", h."occurredAt" + interval '10 minutes') END
      FROM "Henkaten" h, "ShiftRun" s
      WHERE t."henkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "WarningInstance" w
      SET "openedAt" = h."occurredAt", "closedAt" = CASE WHEN w.status = 'CLOSED' THEN h."finalizedAt" ELSE NULL END
      FROM "Henkaten" h, "ShiftRun" s
      WHERE w."henkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "MPReservation" r
      SET "reservedAt" = h."occurredAt",
          "releasedAt" = CASE WHEN r."releasedAt" IS NULL THEN NULL ELSE h."finalizedAt" END
      FROM "Henkaten" h, "ShiftRun" s
      WHERE r."henkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "AssignmentMovement" m SET "movedAt" = h."finalizedAt"
      FROM "Henkaten" h, "ShiftRun" s
      WHERE m."henkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "AssignmentIssue" i
      SET "openedAt" = h."finalizedAt",
          "resolvedAt" = CASE WHEN i.status = 'OPEN' THEN NULL ELSE COALESCE(i."resolvedAt", h."finalizedAt") END
      FROM "Henkaten" h, "ShiftRun" s
      WHERE i."originHenkatenId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "OutboxEvent" o
      SET "occurredAt" = h."occurredAt", "availableAt" = h."occurredAt", "createdAt" = h."occurredAt",
          "processedAt" = CASE WHEN o."processedAt" IS NULL THEN NULL ELSE h."occurredAt" + interval '1 minute' END
      FROM "Henkaten" h, "ShiftRun" s
      WHERE o."aggregateId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "Notification" n SET "createdAt" = o."occurredAt",
          "readAt" = CASE WHEN n."readAt" IS NULL THEN NULL ELSE o."occurredAt" + interval '2 minutes' END
      FROM "OutboxEvent" o
      WHERE n."sourceEventId" = o.id
    `,
    prisma.$executeRaw`
      UPDATE "AuditEvent" a SET "occurredAt" = h."occurredAt"
      FROM "Henkaten" h, "ShiftRun" s
      WHERE a."resourceId" = h.id AND h."shiftRunId" = s.id AND s.status = 'ENDED'
    `,
    prisma.$executeRaw`
      UPDATE "AuditEvent" a SET "occurredAt" = s."scheduledStartAt"
      FROM "ShiftRun" s
      WHERE a."resourceId" = s.id AND s.status = 'ENDED'
    `,
  ]);
}

async function verifySeed(prisma: PrismaClient) {
  const suppliers = await prisma.supplier.findMany({ orderBy: { code: 'asc' } });
  const expectedByCode = new Map(
    localSeedSummary(createLocalSeedPlan()).map((summary) => [summary.code, summary]),
  );
  if (
    suppliers.length !== 2 ||
    suppliers.some(({ sourceMode, active }) => sourceMode !== 'HOSTED' || !active)
  ) {
    throw new Error('Post-seed invariant failed: expected exactly two active Hosted suppliers.');
  }
  for (const supplier of suppliers) {
    const [
      lines,
      jobs,
      members,
      parts,
      shiftTemplates,
      historicalShifts,
      liveShifts,
      henkatens,
      henkatenCategories,
      openWarnings,
      activeReservations,
      unresolvedIssues,
      resolvedIssues,
      photos,
      boardLayouts,
      layoutAudits,
      mpPortraitReuse,
      sensitiveMembers,
      sensitiveJobs,
      sensitivePhotoPaths,
      sensitiveHenkatens,
      shiftLoadStats,
      usageStats,
      timingStats,
      checklistStats,
    ] = await Promise.all([
      prisma.line.count({ where: { supplierId: supplier.id } }),
      prisma.job.count({ where: { supplierId: supplier.id } }),
      prisma.member.count({ where: { supplierId: supplier.id } }),
      prisma.part.count({ where: { supplierId: supplier.id } }),
      prisma.shiftTemplate.count({ where: { supplierId: supplier.id } }),
      prisma.shiftRun.count({ where: { supplierId: supplier.id, status: 'ENDED' } }),
      prisma.shiftRun.count({ where: { supplierId: supplier.id, status: 'ACTIVE' } }),
      prisma.henkaten.groupBy({
        by: ['status'],
        where: { supplierId: supplier.id },
        _count: { _all: true },
      }),
      prisma.henkaten.groupBy({
        by: ['category'],
        where: { supplierId: supplier.id },
        _count: { _all: true },
      }),
      prisma.warningInstance.count({
        where: { supplierId: supplier.id, status: 'OPEN', sourceMode: 'HOSTED' },
      }),
      prisma.mPReservation.count({
        where: { supplierId: supplier.id, releasedAt: null },
      }),
      prisma.assignmentIssue.count({
        where: { supplierId: supplier.id, status: 'OPEN' },
      }),
      prisma.assignmentIssue.count({
        where: { supplierId: supplier.id, status: 'RESOLVED' },
      }),
      prisma.memberPhoto.count({ where: { supplierId: supplier.id, state: 'CURRENT' } }),
      prisma.lineBoardLayout.findMany({
        where: { supplierId: supplier.id },
        orderBy: { lineId: 'asc' },
        include: {
          line: {
            select: {
              shiftRuns: {
                where: { status: 'ACTIVE' },
                select: {
                  workingAssignments: {
                    where: { active: true, includedInPlan: true },
                    select: { jobId: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.auditEvent.count({
        where: {
          supplierId: supplier.id,
          action: 'BOARD_LAYOUT_CREATED',
          resourceType: 'LineBoardLayout',
        },
      }),
      prisma.$queryRaw<Array<{ checksum: string; count: number }>>`
        SELECT p."fullChecksum" AS checksum, count(*)::int AS count
        FROM "MemberPhoto" p
        JOIN "Member" m ON m.id = p."memberId" AND m."supplierId" = p."supplierId"
        WHERE p."supplierId" = ${supplier.id} AND p.state = 'CURRENT' AND m.role = 'MP'
        GROUP BY p."fullChecksum"
        ORDER BY p."fullChecksum"
      `,
      prisma.member.findMany({
        where: { supplierId: supplier.id },
        select: { fullName: true, registrationNumber: true },
      }),
      prisma.job.findMany({
        where: { supplierId: supplier.id },
        select: { name: true },
      }),
      prisma.memberPhoto.findMany({
        where: { supplierId: supplier.id, state: 'CURRENT' },
        select: { fullPath: true, thumbnailPath: true },
      }),
      prisma.henkaten.findMany({
        where: { supplierId: supplier.id },
        select: {
          identifier: true,
          creatorNameSnapshot: true,
          cause: true,
          detail: true,
          affectedObject: true,
          replacementObject: true,
          withdrawalReason: true,
        },
      }),
      prisma.$queryRaw<Array<{ minimum: number; maximum: number; variants: number }>>`
        SELECT min(load)::int AS minimum, max(load)::int AS maximum,
               count(DISTINCT load)::int AS variants
        FROM (
          SELECT h."shiftRunId", count(*)::int AS load
          FROM "Henkaten" h
          JOIN "ShiftRun" s ON s.id = h."shiftRunId"
          WHERE h."supplierId" = ${supplier.id} AND s.status = 'ENDED'
          GROUP BY h."shiftRunId"
        ) loads
      `,
      prisma.$queryRaw<Array<{ parts: number; lineMinimum: number; lineMaximum: number }>>`
        SELECT count(DISTINCT h."partId")::int AS parts,
               min(line_load)::int AS "lineMinimum", max(line_load)::int AS "lineMaximum"
        FROM (
          SELECT h.*, count(*) OVER (PARTITION BY h."lineId")::int AS line_load
          FROM "Henkaten" h
          WHERE h."supplierId" = ${supplier.id}
        ) h
      `,
      prisma.$queryRaw<
        Array<{ eventMinutes: number; resolutionMinutes: number; finalizedAfterShift: number }>
      >`
        SELECT count(DISTINCT extract(epoch FROM (h."occurredAt" - s."scheduledStartAt")) / 60)::int
                 AS "eventMinutes",
               count(DISTINCT extract(epoch FROM (h."finalizedAt" - h."occurredAt")) / 60)::int
                 AS "resolutionMinutes",
               count(*) FILTER (WHERE h."finalizedAt" > s."endedAt")::int
                 AS "finalizedAfterShift"
        FROM "Henkaten" h
        JOIN "ShiftRun" s ON s.id = h."shiftRunId"
        WHERE h."supplierId" = ${supplier.id} AND s.status = 'ENDED'
      `,
      prisma.$queryRaw<Array<{ yesAnswers: number; noAnswers: number }>>`
        SELECT count(*) FILTER (WHERE a.answer = 'YES')::int AS "yesAnswers",
               count(*) FILTER (WHERE a.answer = 'NO')::int AS "noAnswers"
        FROM "HenkatenChecklistAnswer" a
        WHERE a."supplierId" = ${supplier.id}
      `,
    ]);
    const expected = expectedByCode.get(supplier.code);
    if (!expected) throw new Error(`No local seed plan exists for ${supplier.code}.`);
    const statuses = Object.fromEntries(
      henkatens.map(({ status, _count }) => [status, _count._all]),
    );
    const categories = Object.fromEntries(
      henkatenCategories.map(({ category, _count }) => [category, _count._all]),
    );
    const forbiddenLayoutContent = [
      ...sensitiveMembers.flatMap(({ fullName, registrationNumber }) => [
        fullName,
        registrationNumber,
      ]),
      ...sensitivePhotoPaths.flatMap(({ fullPath, thumbnailPath }) => [fullPath, thumbnailPath]),
      ...sensitiveHenkatens.flatMap((henkaten) => Object.values(henkaten)),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    const validLayouts = boardLayouts.every((layout) => {
      const parsed = boardLayoutDocumentSchema.safeParse(layout.document);
      if (!parsed.success || layout.version !== 1 || layout.schemaVersion !== 1) return false;
      const serialized = JSON.stringify(parsed.data);
      if (forbiddenLayoutContent.some((value) => serialized.includes(value))) return false;
      const layoutText = parsed.data.nodes
        .filter((node) => node.type === 'TEXT')
        .map(({ text }) => text);
      if (sensitiveJobs.some(({ name }) => layoutText.includes(name))) return false;
      const jobIds = parsed.data.nodes
        .filter((node) => node.type === 'JOB_SLOT')
        .map(({ jobId }) => jobId)
        .sort();
      const activeJobIds = layout.line.shiftRuns
        .flatMap(({ workingAssignments }) => workingAssignments.map(({ jobId }) => jobId))
        .sort();
      return (
        jobIds.length === 4 &&
        new Set(jobIds).size === 4 &&
        JSON.stringify(jobIds) === JSON.stringify(activeJobIds)
      );
    });
    if (
      lines !== 3 ||
      jobs !== 12 ||
      members !== 22 ||
      parts !== 8 ||
      shiftTemplates !== 3 ||
      historicalShifts !== LOCAL_SEED_HISTORICAL_SHIFT_COUNT ||
      liveShifts !== 3 ||
      Object.values(statuses).reduce((sum, value) => sum + value, 0) !==
        LOCAL_SEED_HENKATEN_PER_SUPPLIER ||
      statuses.APPROVED !== expected.statuses.APPROVED ||
      statuses.REJECTED !== expected.statuses.REJECTED ||
      statuses.CANCELLED !== expected.statuses.CANCELLED ||
      statuses.OPEN !== expected.statuses.OPEN ||
      categories.MAN !== expected.categories.MAN ||
      categories.MACHINE !== expected.categories.MACHINE ||
      categories.MATERIAL !== expected.categories.MATERIAL ||
      categories.METHOD !== expected.categories.METHOD ||
      shiftLoadStats[0]?.minimum !== 1 ||
      shiftLoadStats[0]?.maximum !== 6 ||
      (shiftLoadStats[0]?.variants ?? 0) < 5 ||
      usageStats[0]?.parts !== 8 ||
      (usageStats[0]?.lineMaximum ?? 0) - (usageStats[0]?.lineMinimum ?? 0) < 5 ||
      (timingStats[0]?.eventMinutes ?? 0) < 20 ||
      (timingStats[0]?.resolutionMinutes ?? 0) < 20 ||
      timingStats[0]?.finalizedAfterShift !== 0 ||
      checklistStats[0]?.noAnswers !== 0 ||
      (checklistStats[0]?.yesAnswers ?? 0) < LOCAL_SEED_HENKATEN_PER_SUPPLIER * 4 ||
      openWarnings !== 8 ||
      activeReservations < 1 ||
      unresolvedIssues < 1 ||
      resolvedIssues < 1 ||
      photos !== 19 ||
      boardLayouts.length !== 3 ||
      !validLayouts ||
      layoutAudits !== 3 ||
      mpPortraitReuse.length !== 4 ||
      mpPortraitReuse.some(({ count }) => count !== 3)
    ) {
      throw new Error(
        `Post-seed invariant failed for ${supplier.code}: ${JSON.stringify({
          lines,
          jobs,
          members,
          parts,
          shiftTemplates,
          historicalShifts,
          liveShifts,
          statuses,
          categories,
          shiftLoadStats: shiftLoadStats[0],
          usageStats: usageStats[0],
          timingStats: timingStats[0],
          checklistStats: checklistStats[0],
          openWarnings,
          activeReservations,
          unresolvedIssues,
          resolvedIssues,
          photos,
          boardLayouts: boardLayouts.length,
          validLayouts,
          layoutAudits,
          mpPortraitReuse,
        })}`,
      );
    }
  }
  const [
    externalClients,
    ingestionEvents,
    externalProjections,
    pushSubscriptions,
    pushDeliveries,
    boardLayoutTotal,
    boardLayoutAuditTotal,
    portraitReuseTotal,
    pendingOutbox,
    failedOutbox,
  ] = await Promise.all([
    prisma.externalApiClient.count(),
    prisma.externalIngestionEvent.count(),
    prisma.externalHenkatenProjection.count(),
    prisma.pushSubscription.count(),
    prisma.pushDelivery.count(),
    prisma.lineBoardLayout.count(),
    prisma.auditEvent.count({
      where: { action: 'BOARD_LAYOUT_CREATED', resourceType: 'LineBoardLayout' },
    }),
    prisma.$queryRaw<Array<{ checksum: string; count: number }>>`
      SELECT p."fullChecksum" AS checksum, count(*)::int AS count
      FROM "MemberPhoto" p
      JOIN "Member" m ON m.id = p."memberId" AND m."supplierId" = p."supplierId"
      WHERE p.state = 'CURRENT' AND m.role = 'MP'
      GROUP BY p."fullChecksum"
      ORDER BY p."fullChecksum"
    `,
    prisma.outboxEvent.count({ where: { processedAt: null, failedAt: null } }),
    prisma.outboxEvent.count({ where: { failedAt: { not: null } } }),
  ]);
  if (
    externalClients !== 0 ||
    ingestionEvents !== 0 ||
    externalProjections !== 0 ||
    pushSubscriptions !== 0 ||
    pushDeliveries !== 0 ||
    boardLayoutTotal !== 6 ||
    boardLayoutAuditTotal !== 6 ||
    portraitReuseTotal.length !== 4 ||
    portraitReuseTotal.some(({ count }) => count !== 6) ||
    pendingOutbox !== 0 ||
    failedOutbox !== 0
  ) {
    throw new Error(
      'Post-seed invariant failed: External, synthetic push, or unhealthy outbox state exists.',
    );
  }
}

async function writeManifest(manifest: Manifest) {
  await mkdir(dirname(credentialPath), { recursive: true, mode: 0o700 });
  const temporary = `${credentialPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(temporary, 0o600);
  await rename(temporary, credentialPath);
  await chmod(credentialPath, 0o600);
}

async function syntheticAvatar(accent: string) {
  return sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: accent,
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="256" height="256"><circle cx="128" cy="94" r="46" fill="#fff" fill-opacity=".9"/><path d="M48 238c8-58 40-88 80-88s72 30 80 88" fill="#fff" fill-opacity=".9"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
}

function securePassword() {
  return `L0cal!${randomBytes(24).toString('base64url')}`;
}

function jakartaDate(daysAgo: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() - daysAgo * 86_400_000));
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

function realmOrigin(path: string) {
  return path.startsWith('/api/v1/tmmin') || path.startsWith('/api/v1/auth/tmmin')
    ? tmminOrigin
    : supplierOrigin;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function delay(milliseconds: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

void main().catch(async (error: unknown) => {
  await rm(credentialPath, { force: true });
  const message = error instanceof Error ? error.message : 'Unknown local seed failure';
  process.stderr.write(`Local seed failed: ${message}\n`);
  process.exitCode = 1;
});
