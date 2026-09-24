import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';

import {
  type BoardLayoutDocument,
  type TanokoMapping,
  type TanokoMatrix,
} from '@tmmin-henkaten/contracts';

import { PrismaClient } from '../generated/prisma/client.js';
import { PCR_PROMPT_VERSION } from '../pcr/pcr-prompt.js';
import {
  LOCAL_SEED_HENKATEN_PER_SUPPLIER,
  LOCAL_SEED_HISTORICAL_SHIFT_COUNT,
  assertLocalSeedEnvironment,
  createLocalSeedPlan,
  localSeedSummary,
  localSeedTanokoLevel,
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
type LineShiftDefinition = Resource & {
  lineId: string;
  shiftTemplateId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  timezone: string;
  assignments: Array<{
    id: string;
    jobId: string;
    mpMemberId: string | null;
  }>;
};
type LineShiftOccurrence = LineShiftDefinition & {
  current: boolean;
  effectiveStartAt: string;
  effectiveEndAt: string;
};
type HenkatenResource = Resource & {
  shiftRunId: string;
  status: string;
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
  lineShifts: LineShiftDefinition[][];
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
      await seedHenkatens(prisma, runtime);
      await seedPcrExamples(prisma, runtime);
      await seedCanvasLayouts(runtime);
      runtimes.push(runtime);
    }
    await waitForOutbox(prisma);
    await markOneNotificationRead(runtimes[0]!);
    await waitForOutbox(prisma);
    await verifySeed(prisma);
    for (const runtime of runtimes) await verifySeedDashboard(runtime);
    await writeManifest(manifest);
    const seededHenkaten = localSeedSummary(createLocalSeedPlan()).reduce(
      (total, item) => total + item.henkaten,
      0,
    );
    process.stdout.write(
      `Local seed complete: 2 Hosted suppliers, ${seededHenkaten} Henkaten, and Line Shift configuration. Credentials: ${credentialPath}\n`,
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
          {
            name: plan.jobNames[lineIndex]![jobIndex]!,
            skillCategory: ['HIGH', 'MEDIUM', 'LOW'][jobIndex % 3],
          },
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
        role: 'MP',
      },
      admin.csrf,
    );
    mps.push(response.member);
  }
  // Synthetic local-demo qualifications; production data is never backfilled.
  for (const [index, mp] of mps.entries()) {
    for (const [jobIndex, job] of jobs.flat().entries()) {
      const level = localSeedTanokoLevel(index, jobIndex);
      if (level === null) continue;
      const editor = jobIndex % 2 === 0 ? admin : supervisors[index % supervisors.length]!;
      await editor.api.request(
        'PUT',
        `/api/v1/supplier/tanoko/members/${mp.id}/jobs/${job.id}`,
        {
          expectedVersion: null,
          level,
          note: 'Penilaian awal sintetis untuk demo lokal.',
        },
        editor.csrf,
      );
    }
  }
  // Show reassessment, correction and clearing in history before operational scenarios start.
  const historyMember = mps[13]!;
  const historyJob = jobs[2]![3]!;
  let historyVersion: number | null = null; // This deterministic pair starts unassessed.
  for (const [level, note] of [
    [2, 'Simulasi asesmen: perlu pendampingan pada job ini.'],
    [3, 'Simulasi evaluasi GL: mampu bekerja mandiri setelah pelatihan.'],
    [2, 'Simulasi koreksi asesmen: pendampingan masih diperlukan.'],
    [null, 'Simulasi pembatalan asesmen: menunggu evaluasi ulang.'],
  ] as const) {
    const editor: SessionClient = supervisors[historyVersion === null ? 0 : historyVersion % 2]!;
    const mapping: TanokoMapping = await editor.api.request<TanokoMapping>(
      'PUT',
      `/api/v1/supplier/tanoko/members/${historyMember.id}/jobs/${historyJob.id}`,
      { expectedVersion: historyVersion, level, note },
      editor.csrf,
    );
    historyVersion = mapping.version;
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
  const lineShifts: LineShiftDefinition[][] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (let jobIndex = 0; jobIndex < jobs[lineIndex]!.length; jobIndex += 1) {
      const mp = mps[lineIndex * 4 + jobIndex]!;
      await ensureSeedQualification(
        admin,
        mp.id,
        jobs[lineIndex]![jobIndex]!.id,
        'Asesmen sintetis: MP memenuhi kompetensi minimal level 3 pada assignment Line Shift.',
      );
    }
    const configuredLineShifts: LineShiftDefinition[] = [];
    for (const shift of shifts) {
      const lineShift = await admin.api.request<{
        id: string;
        version: number;
        assignments: Array<{ jobId: string }>;
      }>(
        'POST',
        `/api/v1/supplier/master-data/lines/${lines[lineIndex]!.id}/shifts`,
        { shiftTemplateId: shift.id },
        admin.csrf,
      );
      configuredLineShifts.push(
        await admin.api.request<LineShiftDefinition>(
          'PATCH',
          `/api/v1/supplier/master-data/line-shifts/${lineShift.id}/assignments`,
          {
            expectedVersion: lineShift.version,
            supervisorMemberId: supervisors[lineIndex % supervisors.length]!.memberId,
            lineLeaderMemberId: leaders[lineIndex]!.memberId,
            jobs: lineShift.assignments.map(({ jobId }, jobIndex) => ({
              jobId,
              mpMemberId: mps[(lineIndex * 4 + jobIndex) % mps.length]!.id,
            })),
          },
          admin.csrf,
        ),
      );
    }
    lineShifts.push(configuredLineShifts);
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
    lineShifts,
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

async function seedHenkatens(prisma: PrismaClient, runtime: SupplierRuntime) {
  for (let group = 0; group < LOCAL_SEED_HISTORICAL_SHIFT_COUNT; group += 1) {
    const records = runtime.plan.historical.filter(
      ({ historicalShiftIndex }) => historicalShiftIndex === group,
    );
    if (records.length === 0) {
      throw new Error(`Historical Line Shift occurrence ${group} has no planned Henkaten.`);
    }
    const lineIndex = records[0]!.lineIndex!;
    const occurrence = await currentOccurrence(runtime.leaders[lineIndex]!);
    let shiftRunId: string | undefined;
    for (const [index, record] of records.entries()) {
      const created = await createSeedHenkaten(
        runtime,
        occurrence,
        lineIndex,
        record,
        `historical-${group}-${index}-m${record.eventMinuteOffset}-d${record.resolutionMinuteDelay}`,
        group * 10 + index,
      );
      shiftRunId ??= created.shiftRunId;
      if (shiftRunId !== created.shiftRunId) {
        throw new Error('Historical seed group unexpectedly crossed automatic occurrences.');
      }
      await applySeedOutcome(runtime, lineIndex, created, record.outcome);
    }
    await relocateHistoricalOccurrence(
      prisma,
      runtime,
      shiftRunId!,
      runtime.lineShifts[lineIndex]![records[0]!.shiftTemplateIndex!]!,
      records[0]!.historicalDayOffset!,
    );
  }

  for (const [index, record] of runtime.plan.live.entries()) {
    const lineIndex = index % runtime.lines.length;
    const occurrence = await currentOccurrence(runtime.leaders[lineIndex]!);
    const created = await createSeedHenkaten(
      runtime,
      occurrence,
      lineIndex,
      record,
      `live-${index}`,
      index + runtime.plan.historical.length,
    );
    await applySeedOutcome(runtime, lineIndex, created, record.outcome);
  }
}

const assignedPcrSeedExamples = new Map<string, Set<number>>();
const pcrSeedNarratives = [
  {
    category: 'MACHINE',
    open: true,
    cause: 'Pemasangan torque tool baru dengan merek dan karakteristik kontrol berbeda',
    detail:
      'Nut runner lama diganti dengan tool baru; metode pengencangan, setting torsi, dan validasi kualitas pada part produksi massal berubah.',
    affectedObject: 'Nut runner lama',
    replacementObject: 'Torque tool dengan merek dan karakteristik baru',
  },
  {
    category: 'METHOD',
    open: false,
    cause: 'Perubahan metode produksi pada proses pengelasan',
    detail:
      'Supplier mengubah parameter arus dan kecepatan welding pada part mass production untuk menyesuaikan proses baru.',
    affectedObject: 'Parameter welding disetujui sebelumnya',
    replacementObject: 'Arus dan kecepatan welding baru',
  },
  {
    category: 'MATERIAL',
    open: true,
    cause: 'Penggunaan material pengganti pada proses produksi',
    detail:
      'Informasi perubahan spesifikasi dan sumber material belum lengkap; perlu konfirmasi apakah hanya lot baru atau perubahan material.',
    affectedObject: 'Material yang disetujui',
    replacementObject: 'Material pengganti belum teridentifikasi',
  },
  {
    category: 'MACHINE',
    open: false,
    cause: 'Perbaikan tool dengan komponen pengganti',
    detail:
      'Belum jelas apakah bentuk dan fungsi tool tetap sesuai approval awal atau mengalami modifikasi.',
    affectedObject: 'Tool sebelum perbaikan',
    replacementObject: 'Tool setelah penggantian komponen',
  },
  {
    category: 'MATERIAL',
    open: false,
    cause: 'Perubahan spesifikasi raw material untuk part produksi massal',
    detail:
      'Grade bahan baku dan pemasok material berubah dari spesifikasi yang sebelumnya disetujui.',
    affectedObject: 'Grade dan pemasok lama',
    replacementObject: 'Grade dan pemasok baru',
  },
  {
    category: 'MATERIAL',
    open: true,
    cause: 'Pergantian lot material sesuai FIFO',
    detail:
      'Lot baru berasal dari pemasok dan grade yang sama, dengan spesifikasi tetap; traceability dan incoming inspection sudah diverifikasi.',
    affectedObject: 'Lot sebelumnya',
    replacementObject: 'Lot berikutnya dengan spesifikasi sama',
  },
] as const;

function selectPcrSeedNarrative(runtime: SupplierRuntime, record: SeedHenkatenPlan) {
  const assigned = assignedPcrSeedExamples.get(runtime.plan.code) ?? new Set<number>();
  assignedPcrSeedExamples.set(runtime.plan.code, assigned);
  const index = pcrSeedNarratives.findIndex(
    (example, candidate) =>
      !assigned.has(candidate) &&
      example.category === record.category &&
      example.open === record.outcome.startsWith('OPEN_'),
  );
  if (index < 0) return null;
  assigned.add(index);
  return pcrSeedNarratives[index]!;
}

async function seedPcrExamples(prisma: PrismaClient, runtime: SupplierRuntime) {
  const supplierId = runtime.supplier.id;
  await prisma.pcrAssessment.updateMany({
    where: { supplierId, status: 'PENDING' },
    data: {
      status: 'NO_PCR',
      decisionSource: 'SEED',
      aiNeedsPcr: false,
      aiConfidence: 0.94,
      model: 'local-seed-fixture',
      promptVersion: PCR_PROMPT_VERSION,
    },
  });
  const examples = [
    {
      category: 'MACHINE',
      open: true,
      status: 'PCR',
      cause: 'Pemasangan torque tool baru dengan merek dan karakteristik kontrol berbeda',
      detail:
        'Nut runner lama diganti dengan tool baru; metode pengencangan, setting torsi, dan validasi kualitas pada part produksi massal berubah.',
      assessment:
        'The supplier is introducing a different torque tool and changing the equipment settings used for a mass production part. This is a controlled process change rather than routine replacement or restoration of the same tool to its approved condition. The reported change matches the control items for tool replacement and equipment setting changes, both of which require a Process Change Request. The supplier should submit a PCR through the established channel before implementing the change and prepare evidence for the revised torque settings, first part verification, and traceability of affected production. TMMIN QD should review the proposed controls and approval requirements. This assessment indicates that PCR follow up is needed; it does not grant approval to implement the change.',
    },
    {
      category: 'METHOD',
      open: false,
      status: 'PCR',
      cause: 'Perubahan metode produksi pada proses pengelasan',
      detail:
        'Supplier mengubah parameter arus dan kecepatan welding pada part mass production untuk menyesuaikan proses baru.',
      assessment:
        'The event describes a change to welding current and process speed for an existing mass production part. These parameters define the manufacturing method and can affect the resulting joint quality, so this is a process change under the manufacturing method control item. It is not a temporary check or an ordinary return to a previously approved setting. A Process Change Request should be submitted through the established channel before the revised method is implemented. The supplier should document the former and proposed settings, affected part numbers, change timing, validation results, and traceability of parts produced during the transition. TMMIN QD should confirm the applicable review and approval steps. This is an indication for follow up, not an approval of the new process.',
    },
    {
      category: 'MATERIAL',
      open: true,
      status: 'REVIEW',
      cause: 'Penggunaan material pengganti pada proses produksi',
      detail:
        'Informasi perubahan spesifikasi dan sumber material belum lengkap; perlu konfirmasi apakah hanya lot baru atau perubahan material.',
    },
    {
      category: 'MACHINE',
      open: false,
      status: 'REVIEW',
      cause: 'Perbaikan tool dengan komponen pengganti',
      detail:
        'Belum jelas apakah bentuk dan fungsi tool tetap sesuai approval awal atau mengalami modifikasi.',
    },
    {
      category: 'MATERIAL',
      open: false,
      status: 'PCR',
      manual: true,
      cause: 'Perubahan spesifikasi raw material untuk part produksi massal',
      detail:
        'Grade bahan baku dan pemasok material berubah dari spesifikasi yang sebelumnya disetujui.',
      assessment:
        'TMMIN QD menetapkan PCR karena spesifikasi dan sumber raw material berubah untuk part produksi massal. Supplier perlu mengajukan PCR melalui jalur yang berlaku sebelum implementasi.',
    },
    {
      category: 'MATERIAL',
      open: true,
      status: 'NO_PCR',
      manual: true,
      cause: 'Pergantian lot material sesuai FIFO',
      detail:
        'Lot baru berasal dari pemasok dan grade yang sama, dengan spesifikasi tetap; traceability dan incoming inspection sudah diverifikasi.',
    },
  ] as const;
  for (const [index, example] of examples.entries()) {
    const record = await prisma.henkaten.findFirst({
      where: {
        supplierId,
        category: example.category,
        cause: example.cause,
        status: example.open ? 'OPEN' : { not: 'OPEN' },
      },
    });
    if (!record) throw new Error(`No Henkaten available for PCR seed example ${index}.`);
    await prisma.$transaction(async (tx) => {
      await tx.pcrAssessment.update({
        where: { henkatenId: record.id },
        data: {
          status: example.status,
          decisionSource: 'manual' in example ? 'TMMIN' : 'SEED',
          assessment: 'assessment' in example ? example.assessment : null,
          aiNeedsPcr: 'manual' in example ? example.status === 'NO_PCR' : example.status === 'PCR',
          aiConfidence: example.status === 'REVIEW' ? 0.56 : 0.93,
          aiAssessment:
            'assessment' in example && !('manual' in example) ? example.assessment : null,
          aiMatchedItems:
            example.status === 'PCR'
              ? [example.category === 'MACHINE' ? 27 : example.category === 'METHOD' ? 20 : 35]
              : [],
          reviewedAt: 'manual' in example ? new Date() : null,
          version: { increment: 'manual' in example ? 2 : 1 },
        },
      });
      if ('manual' in example)
        await tx.auditEvent.create({
          data: {
            actorKind: 'USER',
            actorRole: 'TMMIN_QUALITY',
            supplierId,
            action: 'PCR_DECISION_CORRECTED',
            resourceType: 'Henkaten',
            resourceId: record.id,
            changeSummary: {
              from: example.status === 'PCR' ? 'NO_PCR' : 'PCR',
              to: example.status,
              reason:
                example.status === 'PCR'
                  ? example.assessment
                  : 'Lot baru masih dalam spesifikasi dan sumber yang sama.',
            },
            correlationId: `local-pcr-example-${runtime.plan.code}-${index}`,
            result: 'SUCCESS',
          },
        });
    });
  }
}

async function currentOccurrence(leader: SessionClient): Promise<LineShiftOccurrence> {
  const context = await leader.api.request<{
    currentLineShiftIds: string[];
    items: LineShiftOccurrence[];
  }>(
    'GET',
    '/api/v1/supplier/master-data/line-shifts/operational-context',
    undefined,
    undefined,
    200,
  );
  const occurrence = context.items.find(
    ({ id, current }) => current && context.currentLineShiftIds.includes(id),
  );
  if (!occurrence) throw new Error('Expected one current Line Shift occurrence for seed leader.');
  return occurrence;
}

async function createSeedHenkaten(
  runtime: SupplierRuntime,
  occurrence: LineShiftOccurrence,
  lineIndex: number,
  record: SeedHenkatenPlan,
  key: string,
  ordinal: number,
) {
  const job = runtime.jobs[lineIndex]![record.jobIndex ?? ordinal % 4]!;
  const assignment = occurrence.assignments.find(({ jobId }) => jobId === job.id);
  if (!assignment) throw new Error('Seed job is missing from the current Line Shift assignment.');
  const checklist = runtime.checklists[record.category];
  const narrative =
    selectPcrSeedNarrative(runtime, record) ??
    henkatenNarrative(record.category, record.narrativeVariant ?? ordinal);
  const base = {
    lineShiftId: occurrence.id,
    jobId: job.id,
    partId: runtime.parts[record.partIndex ?? ordinal % runtime.parts.length]!.id,
    checklistVersionId: checklist.id,
    checklistAnswers: checklist.itemIds.map((itemId) => ({ itemId, answer: 'YES' })),
    cause: narrative.cause,
    detail: narrative.detail,
  };
  const body =
    record.category === 'MAN'
      ? await seedManBody(runtime, lineIndex, assignment, ordinal, base)
      : {
          ...base,
          category: record.category,
          affectedObject: narrative.affectedObject ?? 'Kondisi proses sebelum perubahan',
          replacementObject: narrative.replacementObject ?? 'Kondisi proses setelah perubahan',
        };
  return runtime.leaders[lineIndex]!.api.request<HenkatenResource>(
    'POST',
    '/api/v1/supplier/henkatens',
    body,
    runtime.leaders[lineIndex]!.csrf,
    201,
    `local-${runtime.plan.code}-${key}`,
  );
}

async function seedManBody(
  runtime: SupplierRuntime,
  lineIndex: number,
  assignment: LineShiftOccurrence['assignments'][number],
  ordinal: number,
  base: Record<string, unknown>,
) {
  const replacement = runtime.mps[(ordinal + lineIndex * 3 + 5) % runtime.mps.length]!;
  await ensureSeedQualification(
    runtime.supervisors[lineIndex % runtime.supervisors.length]!,
    replacement.id,
    assignment.jobId,
    'Simulasi evaluasi GL: kompetensi job tujuan diverifikasi sebelum Henkaten Man.',
  );
  return {
    ...base,
    category: 'MAN',
    lineShiftJobAssignmentId: assignment.id,
    replacementMpMemberId: replacement.id,
  };
}

async function applySeedOutcome(
  runtime: SupplierRuntime,
  lineIndex: number,
  henkaten: HenkatenResource,
  outcome: SeedOutcome,
) {
  const supervisor = runtime.supervisors[lineIndex % runtime.supervisors.length]!;
  const qc = runtime.qcs[lineIndex % runtime.qcs.length]!;
  if (outcome === 'APPROVED_SUPERVISOR_FIRST') {
    const first = await decideSeed(
      supervisor,
      henkaten,
      'APPROVED',
      `${runtime.plan.code}-${henkaten.id}-supervisor`,
    );
    await decideSeed(qc, first, 'APPROVED', `${runtime.plan.code}-${henkaten.id}-qc`);
  } else if (outcome === 'APPROVED_QC_FIRST') {
    const first = await decideSeed(
      qc,
      henkaten,
      'APPROVED',
      `${runtime.plan.code}-${henkaten.id}-qc`,
    );
    await decideSeed(
      supervisor,
      first,
      'APPROVED',
      `${runtime.plan.code}-${henkaten.id}-supervisor`,
    );
  } else if (outcome === 'REJECTED_SUPERVISOR') {
    await decideSeed(
      supervisor,
      henkaten,
      'REJECTED',
      `${runtime.plan.code}-${henkaten.id}-supervisor-reject`,
    );
  } else if (outcome === 'REJECTED_QC') {
    await decideSeed(qc, henkaten, 'REJECTED', `${runtime.plan.code}-${henkaten.id}-qc-reject`);
  } else if (outcome === 'CANCELLED_WITHDRAWN') {
    await runtime.leaders[lineIndex]!.api.request(
      'POST',
      `/api/v1/supplier/henkatens/${henkaten.id}/withdraw`,
      {
        expectedVersion: henkaten.version,
        reason: 'Data objek perubahan perlu dikoreksi sebelum diajukan kembali.',
      },
      runtime.leaders[lineIndex]!.csrf,
      201,
      `${runtime.plan.code}-${henkaten.id}-withdraw`,
    );
  } else if (outcome === 'OPEN_SUPERVISOR_APPROVED') {
    await decideSeed(
      supervisor,
      henkaten,
      'APPROVED',
      `${runtime.plan.code}-${henkaten.id}-supervisor-open`,
    );
  } else if (outcome === 'OPEN_QC_APPROVED') {
    await decideSeed(qc, henkaten, 'APPROVED', `${runtime.plan.code}-${henkaten.id}-qc-open`);
  }
}

function decideSeed(
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

async function ensureSeedQualification(
  assessor: SessionClient,
  memberId: string,
  jobId: string,
  note: string,
) {
  const matrix = await assessor.api.request<TanokoMatrix>(
    'GET',
    '/api/v1/supplier/tanoko',
    undefined,
    undefined,
    200,
  );
  const qualification = matrix.mappings.find(
    (mapping) => mapping.memberId === memberId && mapping.jobId === jobId,
  );
  if ((qualification?.level ?? 0) >= 3) return;
  await assessor.api.request(
    'PUT',
    `/api/v1/supplier/tanoko/members/${memberId}/jobs/${jobId}`,
    {
      expectedVersion: qualification?.version ?? null,
      level: 3,
      note,
    },
    assessor.csrf,
  );
}

async function relocateHistoricalOccurrence(
  prisma: PrismaClient,
  runtime: SupplierRuntime,
  shiftRunId: string,
  targetLineShift: LineShiftDefinition,
  daysAgo: number,
) {
  const businessDate = jakartaDate(daysAgo);
  const scheduledStartAt = jakartaInstant(businessDate, targetLineShift.startTime);
  const scheduledEndAt = jakartaInstant(businessDate, targetLineShift.endTime);
  if (scheduledEndAt <= scheduledStartAt) {
    scheduledEndAt.setUTCDate(scheduledEndAt.getUTCDate() + 1);
  }
  await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL session_replication_role = replica`,
    prisma.shiftRun.update({
      where: { id: shiftRunId },
      data: {
        businessDate: new Date(`${businessDate}T00:00:00.000Z`),
        shiftTemplateId: targetLineShift.shiftTemplateId,
        shiftNameSnapshot: targetLineShift.shiftName,
        shiftStartMinuteSnapshot: minuteOfDay(targetLineShift.startTime),
        shiftEndMinuteSnapshot: minuteOfDay(targetLineShift.endTime),
        scheduledStartAt,
        scheduledEndAt,
        latestPreflightAt: scheduledStartAt,
        createdAt: new Date(scheduledStartAt.getTime() - 5 * 60_000),
        updatedAt: scheduledEndAt,
      },
    }),
    prisma.$executeRaw`
      UPDATE "Henkaten" h
      SET "businessDate" = ${businessDate}::date,
          "lineShiftId" = ${targetLineShift.id}::uuid,
          "shiftNameSnapshot" = ${targetLineShift.shiftName},
          "identifier" = 'HEN-' || ${runtime.plan.code} || '-' || replace(${businessDate}, '-', '')
            || '-' || lpad(h."dailySequence"::text, 4, '0'),
          "occurredAt" = ${scheduledStartAt}::timestamptz
            + substring(h."submissionKey" from '-m([0-9]+)-d')::int * interval '1 minute',
          "effectiveStartAt" = ${scheduledStartAt}::timestamptz,
          "effectiveEndAt" = ${scheduledEndAt}::timestamptz,
          "createdAt" = ${scheduledStartAt}::timestamptz
            + substring(h."submissionKey" from '-m([0-9]+)-d')::int * interval '1 minute',
          "updatedAt" = ${scheduledStartAt}::timestamptz
            + (
                substring(h."submissionKey" from '-m([0-9]+)-d')::int
                + substring(h."submissionKey" from '-d([0-9]+)$')::int
              ) * interval '1 minute',
          "finalizedAt" = ${scheduledStartAt}::timestamptz
            + (
                substring(h."submissionKey" from '-m([0-9]+)-d')::int
                + substring(h."submissionKey" from '-d([0-9]+)$')::int
              ) * interval '1 minute'
      WHERE h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "ManHenkatenDetail" md
      SET "lineShiftJobAssignmentId" = target_assignment.id
      FROM "Henkaten" h
      JOIN "LineShiftJobAssignment" target_assignment
        ON target_assignment."lineShiftId" = ${targetLineShift.id}::uuid
       AND target_assignment."jobId" = h."jobId"
       AND target_assignment."supplierId" = h."supplierId"
      WHERE md."henkatenId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "HenkatenApprovalRoute" r
      SET "createdAt" = h."occurredAt", "updatedAt" = COALESCE(h."finalizedAt", h."occurredAt")
      FROM "Henkaten" h WHERE r."henkatenId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "ApprovalDecision" d
      SET "decidedAt" = h."occurredAt" + (8 + d."resultHenkatenVersion" * 5) * interval '1 minute'
      FROM "Henkaten" h WHERE d."henkatenId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "HenkatenTransition" t
      SET "occurredAt" = CASE WHEN t."fromStatus" IS NULL THEN h."occurredAt"
        ELSE COALESCE(h."finalizedAt", h."occurredAt" + interval '10 minutes') END
      FROM "Henkaten" h WHERE t."henkatenId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "WarningInstance" w
      SET "openedAt" = h."occurredAt",
          "closedAt" = CASE WHEN w.status = 'CLOSED' THEN h."finalizedAt" ELSE NULL END
      FROM "Henkaten" h WHERE w."henkatenId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "AssignmentMovement" m SET "movedAt" = h."occurredAt"
      FROM "Henkaten" h WHERE m."henkatenId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "OutboxEvent" o
      SET "occurredAt" = h."occurredAt", "availableAt" = h."occurredAt", "createdAt" = h."occurredAt",
          "processedAt" = CASE WHEN o."processedAt" IS NULL THEN NULL
            ELSE h."occurredAt" + interval '1 minute' END
      FROM "Henkaten" h
      WHERE o."aggregateId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
    prisma.$executeRaw`
      UPDATE "AuditEvent" a SET "occurredAt" = h."occurredAt"
      FROM "Henkaten" h
      WHERE a."resourceId" = h.id AND h."shiftRunId" = ${shiftRunId}::uuid
    `,
  ]);
}

function henkatenNarrative(
  category: SeedCategory,
  variant: number,
): { cause: string; detail: string; affectedObject?: string; replacementObject?: string } {
  const narratives = {
    MAN: [
      [
        'Rotasi operator untuk pemerataan kompetensi proses',
        'Handover titik kualitas kritis telah dilakukan.',
      ],
      [
        'Penggantian operator pada jam istirahat bergilir',
        'Relief operator ditempatkan dengan monitoring awal.',
      ],
      [
        'Penyesuaian manpower pada proses bottleneck',
        'Kompetensi job tujuan telah diverifikasi oleh GL.',
      ],
    ],
    MACHINE: [
      [
        'Pergantian dies setelah preventive maintenance',
        'Parameter dan hasil first-piece telah diperiksa.',
        'Dies sebelum perawatan',
        'Dies setelah setting',
      ],
      [
        'Penggantian torque tool karena jadwal kalibrasi',
        'Tool pengganti diverifikasi terhadap master torque.',
        'Torque tool lama',
        'Torque tool terkalibrasi',
      ],
      [
        'Restart mesin setelah minor breakdown',
        'Recovery disertai verifikasi first-piece.',
        'Mesin berhenti',
        'Mesin kembali normal',
      ],
    ],
    MATERIAL: [
      [
        'Pergantian lot material sesuai FIFO',
        'Traceability dan spesifikasi lot baru telah diverifikasi.',
        'Lot sebelumnya',
        'Lot berikutnya',
      ],
      [
        'Penggunaan batch sub-component berikutnya',
        'Label dan incoming inspection telah diperiksa.',
        'Batch sebelumnya',
        'Batch baru',
      ],
      [
        'Material alternatif sesuai temporary deviation',
        'Dokumen deviasi dan batas penggunaan dikonfirmasi.',
        'Material standar',
        'Material alternatif',
      ],
    ],
    METHOD: [
      [
        'Revisi urutan kerja untuk mengurangi handling',
        'Urutan baru disosialisasikan dan divalidasi.',
        'Urutan sebelumnya',
        'Urutan revisi',
      ],
      [
        'Penyesuaian urutan pengencangan bolt',
        'Sequence dikonfirmasi terhadap instruksi terbaru.',
        'Sequence sebelumnya',
        'Sequence terbaru',
      ],
      [
        'Peningkatan frekuensi inspeksi sementara',
        'Sampling ditingkatkan berdasarkan tren defect.',
        'Frekuensi normal',
        'Tightened inspection',
      ],
    ],
  } as const;
  const [cause, detail, affectedObject, replacementObject] =
    narratives[category][variant % narratives[category].length]!;
  return {
    cause,
    detail,
    ...(affectedObject ? { affectedObject } : {}),
    ...(replacementObject ? { replacementObject } : {}),
  };
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
      lineShifts,
      lineShiftAssignments,
      historicalOccurrences,
      currentOccurrences,
      henkatens,
      henkatenCategories,
      historicalHenkatens,
      openWarnings,
      layouts,
      photos,
      tanokoMappings,
      configuredAssignments,
    ] = await Promise.all([
      prisma.line.count({ where: { supplierId: supplier.id } }),
      prisma.job.count({ where: { supplierId: supplier.id } }),
      prisma.member.count({ where: { supplierId: supplier.id } }),
      prisma.part.count({ where: { supplierId: supplier.id } }),
      prisma.shiftTemplate.count({ where: { supplierId: supplier.id } }),
      prisma.lineShift.count({ where: { supplierId: supplier.id } }),
      prisma.lineShiftJobAssignment.count({ where: { supplierId: supplier.id } }),
      prisma.shiftRun.count({
        where: { supplierId: supplier.id, scheduledEndAt: { lt: new Date() } },
      }),
      prisma.shiftRun.count({
        where: {
          supplierId: supplier.id,
          scheduledStartAt: { lte: new Date() },
          scheduledEndAt: { gt: new Date() },
        },
      }),
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
      prisma.henkaten.count({
        where: { supplierId: supplier.id, submissionKey: { contains: '-historical-' } },
      }),
      prisma.warningInstance.count({
        where: { supplierId: supplier.id, status: 'OPEN', sourceMode: 'HOSTED' },
      }),
      prisma.lineBoardLayout.count({ where: { supplierId: supplier.id } }),
      prisma.memberPhoto.count({ where: { supplierId: supplier.id, state: 'CURRENT' } }),
      prisma.tanokoMapping.findMany({ where: { supplierId: supplier.id } }),
      prisma.lineShiftJobAssignment.findMany({
        where: { supplierId: supplier.id, mpMemberId: { not: null } },
        select: { jobId: true, mpMemberId: true },
      }),
    ]);
    const expected = expectedByCode.get(supplier.code);
    if (!expected) throw new Error(`No local seed plan exists for ${supplier.code}.`);
    const statuses = Object.fromEntries(
      henkatens.map(({ status, _count }) => [status, _count._all]),
    );
    const categories = Object.fromEntries(
      henkatenCategories.map(({ category, _count }) => [category, _count._all]),
    );
    const assignmentsQualified = configuredAssignments.every((assignment) =>
      tanokoMappings.some(
        (mapping) =>
          mapping.memberId === assignment.mpMemberId &&
          mapping.jobId === assignment.jobId &&
          (mapping.level ?? 0) >= 3,
      ),
    );
    if (
      lines !== 3 ||
      jobs !== 12 ||
      members !== 22 ||
      parts !== 8 ||
      shiftTemplates !== 3 ||
      lineShifts !== 9 ||
      lineShiftAssignments !== 36 ||
      historicalOccurrences !== LOCAL_SEED_HISTORICAL_SHIFT_COUNT ||
      currentOccurrences !== 3 ||
      historicalHenkatens !== 108 ||
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
      openWarnings !== expected.statuses.OPEN ||
      layouts !== 3 ||
      photos !== 19 ||
      !assignmentsQualified
    ) {
      throw new Error(
        `Post-seed invariant failed for ${supplier.code}: ${JSON.stringify({
          lines,
          jobs,
          members,
          parts,
          shiftTemplates,
          lineShifts,
          lineShiftAssignments,
          historicalOccurrences,
          currentOccurrences,
          historicalHenkatens,
          statuses,
          categories,
          openWarnings,
          layouts,
          photos,
          assignmentsQualified,
        })}`,
      );
    }
  }
  const [pendingOutbox, failedOutbox] = await Promise.all([
    prisma.outboxEvent.count({ where: { processedAt: null, failedAt: null } }),
    prisma.outboxEvent.count({ where: { failedAt: { not: null } } }),
  ]);
  if (pendingOutbox !== 0 || failedOutbox !== 0) {
    throw new Error('Post-seed invariant failed: transactional outbox is unhealthy.');
  }
}

async function verifySeedDashboard(runtime: SupplierRuntime) {
  const dashboard = await runtime.admin.api.request<{
    totals: { all: number; open: number; approved: number; rejected: number; cancelled: number };
    trend: unknown[];
  }>('GET', '/api/v1/supplier/dashboard?granularity=DAY', undefined, undefined, 200);
  const expected = localSeedSummary([runtime.plan])[0]!;
  if (
    dashboard.totals.all !== expected.henkaten ||
    dashboard.totals.open !== expected.statuses.OPEN ||
    dashboard.totals.approved !== expected.statuses.APPROVED ||
    dashboard.totals.rejected !== expected.statuses.REJECTED ||
    dashboard.totals.cancelled !== expected.statuses.CANCELLED ||
    dashboard.trend.length === 0
  ) {
    throw new Error(
      `Post-seed dashboard invariant failed for ${runtime.plan.code}: ${JSON.stringify(dashboard.totals)}`,
    );
  }
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

function jakartaInstant(businessDate: string, time: string) {
  return new Date(`${businessDate}T${time}:00+07:00`);
}

function minuteOfDay(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour! * 60 + minute!;
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
