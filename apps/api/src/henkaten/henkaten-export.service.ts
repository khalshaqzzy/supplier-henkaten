import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { henkatenExportFiltersSchema, type HenkatenExportFilters } from '@tmmin-henkaten/contracts';

import type { HenkatenExportJob, Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ProblemException } from '../common/problem.js';
import type { RequestPrincipal } from '../common/request-context.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { PrismaService } from '../persistence/prisma.service.js';
import type { MutationContext } from '../administration/mutation-context.js';

const EXPIRES_MS = 60 * 60 * 1_000;
const BATCH_SIZE = 200;
const DATA_ROWS_PER_SHEET = 1_048_575;
const colors = {
  ink: 'FF17243A',
  muted: 'FF63758B',
  navy: 'FF18365B',
  blue: 'FF4778D2',
  teal: 'FF20A694',
  orange: 'FFF59A45',
  pale: 'FFEDF3FA',
  white: 'FFFFFFFF',
};

type ExportRow = Prisma.HenkatenGetPayload<{
  include: typeof exportInclude;
}>;

const exportInclude = {
  approvalRoutes: {
    include: {
      decision: true,
      routingHistory: { orderBy: { assignedAt: 'asc' as const } },
    },
    orderBy: { route: 'asc' as const },
  },
  checklistSnapshot: {
    include: { answers: { orderBy: { displayOrderSnapshot: 'asc' as const } } },
  },
  transitions: { orderBy: [{ occurredAt: 'asc' as const }, { id: 'asc' as const }] },
  manDetail: true,
  movement: { include: { sourceLine: true, sourceJob: true } },
  pcrAssessment: true,
  clonedFrom: { select: { identifier: true } },
} satisfies Prisma.HenkatenInclude;

@Injectable()
export class HenkatenExportService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(HenkatenExportService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    void this.prisma.henkatenExportJob
      .updateMany({ where: { status: 'RUNNING' }, data: { status: 'QUEUED', processed: 0 } })
      .then(() => this.poll())
      .catch((error: unknown) => this.logger.error({ error }, 'Export recovery failed'));
    this.timer = setInterval(() => void this.poll(), 2_000);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  async create(
    supplierId: string,
    principal: RequestPrincipal,
    filters: HenkatenExportFilters,
    context: MutationContext,
  ) {
    this.assertRole(principal, supplierId);
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, active: true, sourceMode: true, sourceEpoch: true },
    });
    if (!supplier) throw notFound();
    if (
      principal.realm === 'SUPPLIER' &&
      (!supplier.active ||
        supplier.sourceMode !== 'HOSTED' ||
        supplier.sourceEpoch !== principal.sourceEpoch)
    ) {
      throw forbidden();
    }
    const active = await this.prisma.henkatenExportJob.count({
      where: {
        requestedById: principal.userId,
        requestedRealm: principal.realm,
        status: { in: ['QUEUED', 'RUNNING'] },
        expiresAt: { gt: new Date() },
      },
    });
    if (active >= 2) {
      throw new ProblemException({
        status: 409,
        code: 'STATE_CONFLICT',
        title: 'Export sedang diproses',
        detail: 'Tunggu ekspor sebelumnya selesai.',
      });
    }
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.henkatenExportJob.create({
        data: {
          supplierId,
          requestedById: principal.userId,
          requestedRealm: principal.realm,
          filters,
          expiresAt: new Date(Date.now() + EXPIRES_MS),
        },
      });
      await this.audit.write(
        {
          actorKind: 'USER',
          actorUserId: context.actorUserId,
          actorRole: context.actorRole,
          ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
          supplierId,
          action: 'HENKATEN_EXPORT_REQUESTED',
          resourceType: 'HenkatenExportJob',
          resourceId: created.id,
          changeSummary: {
            filters,
            ...(principal.impersonatedBy
              ? { tmminOperatorId: principal.impersonatedBy.userId }
              : {}),
          },
          correlationId: context.correlationId,
          ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
          ...(context.userAgent ? { userAgent: context.userAgent } : {}),
          sourceMode: 'HOSTED',
        },
        tx,
      );
      return created;
    });
    void this.poll();
    return presentJob(job);
  }

  async status(supplierId: string, principal: RequestPrincipal, id: string) {
    return presentJob(await this.authorizedJob(supplierId, principal, id));
  }

  async file(
    supplierId: string,
    principal: RequestPrincipal,
    id: string,
    context: MutationContext,
  ) {
    const job = await this.authorizedJob(supplierId, principal, id);
    if (job.status !== 'READY') {
      throw new ProblemException({
        status: 409,
        code: 'STATE_CONFLICT',
        title: 'Export belum siap',
        detail: 'Tunggu pembuatan workbook selesai.',
      });
    }
    const path = this.filePath(job.id);
    try {
      await stat(path);
    } catch {
      throw notFound();
    }
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: supplierId },
      select: { code: true },
    });
    await this.audit.write({
      actorKind: 'USER',
      actorUserId: context.actorUserId,
      actorRole: context.actorRole,
      ...(context.actorSupplierId ? { actorSupplierId: context.actorSupplierId } : {}),
      supplierId,
      action: 'HENKATEN_EXPORT_DOWNLOADED',
      resourceType: 'HenkatenExportJob',
      resourceId: id,
      changeSummary: {
        records: job.total,
        ...(principal.impersonatedBy ? { tmminOperatorId: principal.impersonatedBy.userId } : {}),
      },
      correlationId: context.correlationId,
      ...(context.sourceIp ? { sourceIp: context.sourceIp } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      sourceMode: 'HOSTED',
    });
    return {
      stream: createReadStream(path),
      filename: `henkaten-${supplier.code}-${job.createdAt.toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private async authorizedJob(supplierId: string, principal: RequestPrincipal, id: string) {
    this.assertRole(principal, supplierId);
    if (principal.realm === 'SUPPLIER') {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { active: true, sourceMode: true, sourceEpoch: true },
      });
      if (
        !supplier?.active ||
        supplier.sourceMode !== 'HOSTED' ||
        supplier.sourceEpoch !== principal.sourceEpoch
      ) {
        throw forbidden();
      }
    }
    const job = await this.prisma.henkatenExportJob.findFirst({
      where: {
        id,
        supplierId,
        requestedById: principal.userId,
        requestedRealm: principal.realm,
      },
    });
    if (!job || job.expiresAt <= new Date()) throw notFound();
    return job;
  }

  private assertRole(principal: RequestPrincipal, supplierId: string) {
    if (
      (principal.realm === 'SUPPLIER' &&
        principal.role === 'SUPPLIER_ADMIN' &&
        principal.purpose === 'NORMAL' &&
        principal.supplierId === supplierId) ||
      (principal.realm === 'TMMIN' && principal.role === 'TMMIN_ADMIN')
    ) {
      return;
    }
    throw forbidden();
  }

  private async poll(): Promise<void> {
    if (this.stopping || this.inFlight) return;
    this.inFlight = this.runNext().finally(() => {
      this.inFlight = undefined;
    });
    await this.inFlight;
  }

  private async runNext(): Promise<void> {
    try {
      await this.expireFiles();
      const job = await this.prisma.henkatenExportJob.findFirst({
        where: { status: 'QUEUED', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) return;
      const claimed = await this.prisma.henkatenExportJob.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: new Date(), processed: 0 },
      });
      if (!claimed.count) return;
      await this.generate(job);
    } catch (error) {
      this.logger.error({ error }, 'Export polling failed');
    }
  }

  private async generate(job: HenkatenExportJob): Promise<void> {
    const partial = join(this.config.exportStorageRoot, `${job.id}.part`);
    try {
      await mkdir(this.config.exportStorageRoot, { recursive: true, mode: 0o700 });
      await rm(partial, { force: true });
      const filters = henkatenExportFiltersSchema.parse(job.filters);
      const supplier = await this.prisma.supplier.findUniqueOrThrow({
        where: { id: job.supplierId },
        select: { code: true, name: true, timezone: true },
      });
      const writer = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: createWriteStream(partial, { mode: 0o600 }),
        useStyles: true,
        useSharedStrings: false,
      });
      writer.creator = 'Henkaten';
      writer.created = job.createdAt;
      const summary = writer.addWorksheet('Ringkasan', {
        views: [{ state: 'frozen', ySplit: 5 }],
      });
      const records = sheetGroup(writer, 'Henkaten', [
        'Henkaten ID',
        'Business date',
        'Kejadian lokal',
        'Kejadian UTC',
        '4M',
        'Status',
        'Line code',
        'Line',
        'Job',
        'Shift',
        'Part number',
        'Part',
        'Cause',
        'Detail',
        'Objek lama',
        'Objek baru',
        'Dibuat oleh',
        'Efektif mulai',
        'Efektif akhir',
        'Final lokal',
        'Supervisor',
        'QC',
        'PCR',
        'Sumber PCR',
        'Catatan PCR',
        'MP lama',
        'MP baru',
        'Asal line',
        'Asal job',
        'Man dipindah',
        'Batal karena',
        'Alasan withdraw',
        'Clone dari',
      ]);
      const approvals = sheetGroup(writer, 'Approval', [
        'Henkaten ID',
        'Route',
        'Jenis',
        'Status / keputusan',
        'Penanggung jawab',
        'Aktor',
        'Waktu lokal',
        'Komentar',
      ]);
      const checklist = sheetGroup(writer, 'Checklist', [
        'Henkaten ID',
        'Versi',
        'Urutan',
        'Pertanyaan',
        'Jawaban',
      ]);
      const history = sheetGroup(writer, 'Riwayat', [
        'Henkaten ID',
        'Waktu lokal',
        'Peristiwa',
        'Dari',
        'Ke',
        'Aktor',
        'Alasan',
      ]);
      const counts = new Map<string, number>();
      const categories = new Map<string, number>();
      const lines = new Map<string, number>();
      const months = new Map<string, number>();
      let processed = 0;
      const where = exportWhere(job.supplierId, job.createdAt, filters);
      await this.prisma.$transaction(
        async (tx) => {
          const total = await tx.henkaten.count({ where });
          await this.prisma.henkatenExportJob.update({ where: { id: job.id }, data: { total } });
          let cursor: string | undefined;
          while (true) {
            const batch = await tx.henkaten.findMany({
              where,
              include: exportInclude,
              orderBy: { id: 'asc' },
              take: BATCH_SIZE,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
            if (!batch.length) break;
            for (const row of batch) {
              writeRecord(row, supplier.timezone, records, approvals, checklist, history);
              increment(counts, row.status);
              increment(categories, row.category);
              increment(lines, `${row.lineCodeSnapshot} · ${row.lineNameSnapshot}`);
              increment(months, row.businessDate.toISOString().slice(0, 7));
              processed++;
            }
            cursor = batch.at(-1)!.id;
            await this.prisma.henkatenExportJob.update({
              where: { id: job.id },
              data: { processed },
            });
          }
        },
        { isolationLevel: 'RepeatableRead', timeout: 900_000 },
      );
      writeSummary(
        summary,
        supplier,
        filters,
        processed,
        counts,
        categories,
        lines,
        months,
        job.createdAt,
      );
      for (const group of [records, approvals, checklist, history]) group.commit();
      summary.commit();
      await writer.commit();
      await rename(partial, this.filePath(job.id));
      await this.prisma.henkatenExportJob.update({
        where: { id: job.id },
        data: { status: 'READY', total: processed, processed, finishedAt: new Date() },
      });
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      this.logger.error({ jobId: job.id, error }, 'Henkaten export failed');
      await this.prisma.henkatenExportJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorCode: 'EXPORT_FAILED', finishedAt: new Date() },
      });
    }
  }

  private async expireFiles(): Promise<void> {
    const expired = await this.prisma.henkatenExportJob.findMany({
      where: { expiresAt: { lt: new Date() }, status: { not: 'RUNNING' } },
      select: { id: true },
      take: 100,
    });
    for (const job of expired) {
      await rm(this.filePath(job.id), { force: true }).catch(() => undefined);
      await rm(join(this.config.exportStorageRoot, `${job.id}.part`), { force: true }).catch(
        () => undefined,
      );
      await this.prisma.henkatenExportJob.delete({ where: { id: job.id } });
    }
  }

  private filePath(id: string): string {
    return join(this.config.exportStorageRoot, `${id}.xlsx`);
  }
}

function exportWhere(
  supplierId: string,
  createdAt: Date,
  filter: HenkatenExportFilters,
): Prisma.HenkatenWhereInput {
  return {
    supplierId,
    sourceMode: 'HOSTED',
    createdAt: { lte: createdAt },
    ...(filter.from || filter.to
      ? {
          businessDate: {
            ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
            ...(filter.to ? { lte: new Date(`${filter.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
    ...(filter.lineId ? { lineId: filter.lineId } : {}),
    ...(filter.shiftTemplateId ? { shiftRun: { shiftTemplateId: filter.shiftTemplateId } } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.part
      ? {
          OR: [
            { partNumberSnapshot: { contains: filter.part, mode: 'insensitive' } },
            { partNameSnapshot: { contains: filter.part, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filter.approvalRoute || filter.approvalStatus
      ? {
          approvalRoutes: {
            some: {
              ...(filter.approvalRoute ? { route: filter.approvalRoute } : {}),
              ...(filter.approvalStatus ? { status: filter.approvalStatus } : {}),
            },
          },
        }
      : {}),
    ...(filter.pcrStatus ? { pcrAssessment: { status: filter.pcrStatus } } : {}),
  };
}

function presentJob(job: HenkatenExportJob) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    errorCode: job.errorCode,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
  };
}

function forbidden() {
  return new ProblemException({
    status: 403,
    code: 'FORBIDDEN',
    title: 'Akses ditolak',
    detail: 'Ekspor tidak tersedia untuk akun ini.',
  });
}

function notFound() {
  return new ProblemException({
    status: 404,
    code: 'RESOURCE_NOT_FOUND',
    title: 'Export tidak ditemukan',
    detail: 'File tidak tersedia atau sudah kedaluwarsa.',
  });
}

type WorkbookWriter = ExcelJS.stream.xlsx.WorkbookWriter;
type SheetGroup = ReturnType<typeof sheetGroup>;

function sheetGroup(workbook: WorkbookWriter, name: string, headers: string[]) {
  let sheet: ExcelJS.Worksheet;
  let count = 0;
  let number = 0;
  const next = () => {
    number++;
    sheet = workbook.addWorksheet(number === 1 ? name : `${name} ${number}`, {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    sheet.columns = headers.map((header, index) => ({
      header,
      key: String(index),
      width: Math.min(35, Math.max(15, header.length + 4)),
    }));
    styleHeader(sheet.getRow(1));
    sheet.getRow(1).commit();
    count = 0;
  };
  next();
  return {
    add(values: Array<string | number | null>) {
      if (count >= DATA_ROWS_PER_SHEET) {
        sheet.commit();
        next();
      }
      const row = sheet.addRow(values.map((value) => value ?? ''));
      row.font = { name: 'Aptos', size: 10, color: { argb: colors.ink } };
      row.alignment = { vertical: 'middle' };
      if (count % 2 === 1)
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9FC' } };
      row.commit();
      count++;
    },
    commit() {
      sheet.commit();
    },
  };
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 30;
  row.font = { name: 'Aptos Display', size: 10, bold: true, color: { argb: colors.white } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
  row.alignment = { vertical: 'middle', wrapText: true };
}

function local(value: Date | null | undefined, timezone: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);
}

function writeRecord(
  row: ExportRow,
  timezone: string,
  records: SheetGroup,
  approvals: SheetGroup,
  checklist: SheetGroup,
  history: SheetGroup,
) {
  const supervisor = row.approvalRoutes.find((route) => route.route === 'SUPERVISOR');
  const qc = row.approvalRoutes.find((route) => route.route === 'QC');
  records.add([
    row.identifier,
    row.businessDate.toISOString().slice(0, 10),
    local(row.occurredAt, timezone),
    row.occurredAt.toISOString(),
    row.category,
    row.status,
    row.lineCodeSnapshot,
    row.lineNameSnapshot,
    row.jobNameSnapshot,
    row.shiftNameSnapshot,
    row.partNumberSnapshot,
    row.partNameSnapshot,
    row.cause,
    row.detail,
    row.affectedObject,
    row.replacementObject,
    row.creatorNameSnapshot,
    local(row.effectiveStartAt, timezone),
    local(row.effectiveEndAt, timezone),
    local(row.finalizedAt, timezone),
    supervisor?.status ?? '',
    qc?.status ?? '',
    row.pcrAssessment?.status ?? '',
    row.pcrAssessment?.decisionSource ?? '',
    row.pcrAssessment?.assessment ?? '',
    row.manDetail?.replacedMpNameSnapshot ?? '',
    row.manDetail?.replacementMpNameSnapshot ?? '',
    row.movement?.sourceLine?.name ?? '',
    row.movement?.sourceJob?.name ?? '',
    local(row.movement?.movedAt, timezone),
    row.cancellationReason ?? '',
    row.withdrawalReason ?? '',
    row.clonedFrom?.identifier ?? '',
  ]);
  for (const route of row.approvalRoutes) {
    approvals.add([
      row.identifier,
      route.route,
      'Route',
      route.status,
      route.currentResponsibleNameSnapshot ?? route.initialResponsibleNameSnapshot ?? '',
      route.decision?.actorNameSnapshot ?? '',
      local(route.decision?.decidedAt, timezone),
      route.decision?.comment ?? '',
    ]);
    for (const reroute of route.routingHistory) {
      approvals.add([
        row.identifier,
        route.route,
        'Reroute',
        '',
        reroute.toNameSnapshot,
        reroute.fromNameSnapshot ?? '',
        local(reroute.assignedAt, timezone),
        '',
      ]);
    }
  }
  for (const answer of row.checklistSnapshot?.answers ?? []) {
    checklist.add([
      row.identifier,
      row.checklistSnapshot?.versionNumber ?? '',
      answer.displayOrderSnapshot,
      answer.labelSnapshot,
      answer.answer,
    ]);
  }
  for (const transition of row.transitions) {
    history.add([
      row.identifier,
      local(transition.occurredAt, timezone),
      'Status',
      transition.fromStatus ?? '',
      transition.toStatus,
      transition.actorName,
      transition.reason ?? '',
    ]);
  }
  if (row.movement) {
    history.add([
      row.identifier,
      local(row.movement.movedAt, timezone),
      'Perpindahan Man',
      row.movement.sourceJob?.name ?? '',
      row.jobNameSnapshot,
      row.movement.movedMpNameSnapshot,
      '',
    ]);
  }
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function writeSummary(
  sheet: ExcelJS.Worksheet,
  supplier: { code: string; name: string; timezone: string },
  filters: HenkatenExportFilters,
  total: number,
  statuses: Map<string, number>,
  categories: Map<string, number>,
  lines: Map<string, number>,
  months: Map<string, number>,
  createdAt: Date,
) {
  sheet.columns = [
    { width: 35 },
    { width: 16 },
    ...Array.from({ length: 12 }, () => ({ width: 5 })),
  ];
  sheet.mergeCells('A1:N2');
  const title = sheet.getCell('A1');
  title.value = 'HENKATEN · RINGKASAN';
  title.font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: colors.white } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
  title.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 32;
  sheet.getRow(2).height = 15;
  for (const [label, value] of [
    ['Supplier', `${supplier.code} · ${supplier.name}`],
    ['Periode', `${filters.from ?? 'Awal'} — ${filters.to ?? 'Sekarang'}`],
    [
      'Filter',
      [
        filters.status && `Status ${filters.status}`,
        filters.category && `4M ${filters.category}`,
        filters.lineId && `Line ${filters.lineId}`,
        filters.shiftTemplateId && `Shift ${filters.shiftTemplateId}`,
        filters.part && `Part ${filters.part}`,
        filters.approvalRoute && `Route ${filters.approvalRoute}`,
        filters.approvalStatus && `Approval ${filters.approvalStatus}`,
        filters.pcrStatus && `PCR ${filters.pcrStatus}`,
      ]
        .filter(Boolean)
        .join(' · ') || 'Semua',
    ],
    ['Timezone', supplier.timezone],
    ['Dibuat', local(createdAt, supplier.timezone)],
    ['Henkaten', String(total)],
  ]) {
    const row = sheet.addRow([label, value]);
    row.font = { name: 'Aptos', size: 11, color: { argb: colors.ink } };
    row.getCell(1).font = { name: 'Aptos', size: 10, bold: true, color: { argb: colors.muted } };
    row.height = 23;
    row.commit();
  }
  sheet.addRow([]).commit();
  chartSection(sheet, 'STATUS', statuses, colors.blue);
  sheet.addRow([]).commit();
  chartSection(sheet, '4M', categories, colors.teal);
  sheet.addRow([]).commit();
  chartSection(
    sheet,
    'LINE · TOP 10',
    new Map([...lines].sort((a, b) => b[1] - a[1]).slice(0, 10)),
    colors.orange,
  );
  sheet.addRow([]).commit();
  chartSection(
    sheet,
    'TREN BULANAN · 12 TERAKHIR',
    new Map([...months].sort(([a], [b]) => a.localeCompare(b)).slice(-12)),
    colors.blue,
  );
}

function chartSection(
  sheet: ExcelJS.Worksheet,
  label: string,
  values: Map<string, number>,
  color: string,
) {
  const heading = sheet.addRow([label]);
  heading.height = 27;
  heading.font = { name: 'Aptos Display', size: 11, bold: true, color: { argb: colors.navy } };
  heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } };
  heading.commit();
  const max = Math.max(1, ...values.values());
  for (const [name, count] of values) {
    const segments = Math.max(1, Math.round((count / max) * 12));
    const row = sheet.addRow([name, count]);
    row.height = 22;
    row.font = { name: 'Aptos', size: 10, color: { argb: colors.ink } };
    row.getCell(2).font = { name: 'Aptos', size: 10, bold: true, color: { argb: colors.ink } };
    for (let index = 0; index < 12; index++) {
      const cell = row.getCell(index + 3);
      cell.value = ' ';
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: index < segments ? color : colors.pale },
      };
    }
    row.commit();
  }
}
