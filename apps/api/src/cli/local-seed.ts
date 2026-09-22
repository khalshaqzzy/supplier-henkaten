import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';

import { type BoardLayoutDocument, type TanokoMapping } from '@tmmin-henkaten/contracts';

import { PrismaClient } from '../generated/prisma/client.js';
import {
  assertLocalSeedEnvironment,
  createLocalSeedPlan,
  localSeedTanokoLevel,
  type SeedCategory,
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
      await seedCanvasLayouts(runtime);
      runtimes.push(runtime);
    }
    await waitForOutbox(prisma);
    await writeManifest(manifest);
    process.stdout.write(
      `Local seed complete: 2 Hosted suppliers with Line Shift configuration. Credentials: ${credentialPath}\n`,
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
        registrationNumber: `SYN-${plan.code}-MP-${String(index + 1).padStart(3, '0')}`,
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
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
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
      await admin.api.request(
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
      );
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
