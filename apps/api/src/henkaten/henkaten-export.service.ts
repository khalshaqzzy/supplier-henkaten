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
import { addEditableCharts, type ExportChart } from './henkaten-export-charts.js';

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
  green: 'FF16A34A',
  red: 'FFF04438',
  amber: 'FFF59E0B',
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
    const charted = join(this.config.exportStorageRoot, `${job.id}.charted.part`);
    try {
      await mkdir(this.config.exportStorageRoot, { recursive: true, mode: 0o700 });
      await rm(partial, { force: true });
      await rm(charted, { force: true });
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
        views: [{ state: 'frozen', ySplit: 7, showGridLines: false }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 2 },
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
      const monthlyCategory = new Map<string, Map<string, number>>();
      const lineStatus = new Map<string, Map<string, number>>();
      const parts = new Map<string, number>();
      const pending = new Map<string, number>();
      const pcr = new Map<string, number>();
      const filterLabels = {
        line: filters.lineId
          ? await this.prisma.line.findFirst({
              where: { id: filters.lineId, supplierId: job.supplierId },
              select: { code: true, name: true },
            })
          : null,
        shift: filters.shiftTemplateId
          ? await this.prisma.shiftTemplate.findFirst({
              where: { id: filters.shiftTemplateId, supplierId: job.supplierId },
              select: { name: true },
            })
          : null,
      };
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
              const line = `${row.lineCodeSnapshot} · ${row.lineNameSnapshot}`;
              const month = row.businessDate.toISOString().slice(0, 7);
              increment(lines, line);
              increment(months, month);
              incrementNested(lineStatus, line, row.status);
              incrementNested(monthlyCategory, month, row.category);
              increment(parts, row.partNumberSnapshot || 'Other');
              for (const route of row.approvalRoutes) {
                if (route.status === 'PENDING') increment(pending, route.route);
              }
              increment(pcr, row.pcrAssessment?.status ?? 'BELUM ADA');
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
      const charts = writeSummary(
        summary,
        supplier,
        filters,
        filterLabels,
        processed,
        counts,
        categories,
        lines,
        months,
        monthlyCategory,
        lineStatus,
        parts,
        pending,
        pcr,
        job.createdAt,
      );
      for (const group of [records, approvals, checklist, history]) group.commit();
      summary.commit();
      await writer.commit();
      await addEditableCharts(partial, charted, charts);
      await rename(charted, this.filePath(job.id));
      await rm(partial, { force: true });
      await this.prisma.henkatenExportJob.update({
        where: { id: job.id },
        data: { status: 'READY', total: processed, processed, finishedAt: new Date() },
      });
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      await rm(charted, { force: true }).catch(() => undefined);
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

function incrementNested(map: Map<string, Map<string, number>>, outer: string, inner: string) {
  const counts = map.get(outer) ?? new Map<string, number>();
  increment(counts, inner);
  map.set(outer, counts);
}

function shortChartLabel(value: string): string {
  return value.length > 20 ? `${value.slice(0, 19)}…` : value;
}

function writeSummary(
  sheet: ExcelJS.Worksheet,
  supplier: { code: string; name: string; timezone: string },
  filters: HenkatenExportFilters,
  filterLabels: { line: { code: string; name: string } | null; shift: { name: string } | null },
  total: number,
  statuses: Map<string, number>,
  categories: Map<string, number>,
  lines: Map<string, number>,
  months: Map<string, number>,
  monthlyCategory: Map<string, Map<string, number>>,
  lineStatus: Map<string, Map<string, number>>,
  parts: Map<string, number>,
  pending: Map<string, number>,
  pcr: Map<string, number>,
  createdAt: Date,
): ExportChart[] {
  sheet.columns = Array.from({ length: 16 }, () => ({ width: 12 }));
  sheet.pageSetup.printArea = 'A1:P71';
  const merge = (range: string) => sheet.mergeCells(range);
  merge('A1:P2');
  for (const row of [4, 5, 6, 7]) {
    merge(`A${row}:C${row}`);
    merge(`D${row}:P${row}`);
  }
  const cards = ['A:C', 'D:F', 'G:I', 'J:L', 'M:P'];
  for (const range of cards) {
    const [first, last] = range.split(':');
    merge(`${first}9:${last}9`);
    merge(`${first}10:${last}11`);
  }
  for (const row of [13, 31, 49]) {
    merge(`A${row}:H${row}`);
    merge(`I${row}:P${row}`);
  }
  merge('A67:P67');
  merge('A70:P70');
  merge('A74:P74');

  const statusEntries = ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'].map(
    (key) => [key, statuses.get(key) ?? 0] as const,
  );
  const categoryEntries = ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'].map(
    (key) => [key, categories.get(key) ?? 0] as const,
  );
  const rank = (items: Map<string, number>) =>
    [...items].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  const lineEntries = rank(lines);
  const partEntries = rank(parts);
  const pcrEntries = ['PCR', 'NO_PCR', 'REVIEW', 'PENDING', 'BELUM ADA'].map(
    (key) => [key, pcr.get(key) ?? 0] as const,
  );
  const businessToday = local(createdAt, supplier.timezone).slice(0, 10);
  const endMonth = (filters.to && filters.to < businessToday ? filters.to : businessToday).slice(
    0,
    7,
  );
  const firstMonth = filters.from?.slice(0, 7);
  const monthEntries: Array<[string, number]> = [];
  const end = new Date(`${endMonth}-01T00:00:00.000Z`);
  for (let offset = 11; offset >= 0; offset--) {
    const month = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset, 1))
      .toISOString()
      .slice(0, 7);
    if (!firstMonth || month >= firstMonth) monthEntries.push([month, months.get(month) ?? 0]);
  }
  const filtersText =
    [
      filters.status && `Status ${filters.status}`,
      filters.category && `4M ${filters.category}`,
      filters.lineId &&
        `Line ${filterLabels.line ? `${filterLabels.line.code} · ${filterLabels.line.name}` : filters.lineId}`,
      filters.shiftTemplateId && `Shift ${filterLabels.shift?.name ?? filters.shiftTemplateId}`,
      filters.part && `Part ${filters.part}`,
      filters.approvalRoute && `Route ${filters.approvalRoute}`,
      filters.approvalStatus && `Approval ${filters.approvalStatus}`,
      filters.pcrStatus && `PCR ${filters.pcrStatus}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Semua';

  const content = new Map<string, string | number>();
  const put = (address: string, value: string | number) => content.set(address, value);
  put('A1', 'HENKATEN  /  RINGKASAN');
  put('A4', 'SUPPLIER');
  put('D4', `${supplier.code} · ${supplier.name}`);
  put('A5', 'PERIODE');
  put('D5', `${filters.from ?? 'Awal'} — ${filters.to ?? 'Sekarang'}`);
  put('A6', 'FILTER');
  put('D6', filtersText);
  put('A7', 'DIBUAT');
  put('D7', `${local(createdAt, supplier.timezone)} · ${supplier.timezone}`);
  const metrics = [
    ['TOTAL', total],
    ['OPEN', statuses.get('OPEN') ?? 0],
    ['APPROVED', statuses.get('APPROVED') ?? 0],
    ['REJECTED', statuses.get('REJECTED') ?? 0],
    ['CANCELLED', statuses.get('CANCELLED') ?? 0],
  ] as const;
  for (let index = 0; index < cards.length; index++) {
    const first = cards[index]!.split(':')[0]!;
    put(`${first}9`, metrics[index]![0]);
    put(`${first}10`, metrics[index]![1]);
  }
  for (const [address, value] of [
    ['A13', 'STATUS'],
    ['I13', 'KATEGORI 4M'],
    ['A31', 'LINE · TOP 10, KOMPOSISI STATUS'],
    ['I31', 'TREN BULANAN · KOMPOSISI 4M'],
    ['A49', 'PART · TOP 10'],
    ['I49', 'KEPUTUSAN PCR'],
    ['A67', 'PERSETUJUAN TERTUNDA'],
    ['A74', 'DATA SUMBER GRAFIK · dapat diedit di Excel'],
  ] as const)
    put(address, value);
  put('A69', 'Supervisor');
  put('D69', pending.get('SUPERVISOR') ?? 0);
  put('I69', 'QC');
  put('L69', pending.get('QC') ?? 0);
  put(
    'A70',
    'Jumlah status dan kategori 4M selalu sama dengan TOTAL. Komposisi Line dan Bulan memakai data yang sama.',
  );

  const simpleTable = (
    labelColumn: string,
    valueColumn: string,
    headerRow: number,
    title: string,
    entries: readonly (readonly [string, number])[],
  ) => {
    put(`${labelColumn}${headerRow}`, title);
    put(`${valueColumn}${headerRow}`, 'Jumlah');
    (entries.length ? entries : [['Tidak ada data', 0] as const]).forEach(
      ([label, count], index) => {
        put(`${labelColumn}${headerRow + index + 1}`, label);
        put(`${valueColumn}${headerRow + index + 1}`, count);
      },
    );
  };
  simpleTable('A', 'B', 76, 'Status', statusEntries);
  simpleTable('E', 'F', 76, '4M', categoryEntries);
  simpleTable('I', 'J', 76, 'PCR', pcrEntries);
  simpleTable('O', 'P', 84, 'Part', partEntries);
  statusEntries.forEach(([, count], index) => put(`C${77 + index}`, total ? count / total : 0));
  categoryEntries.forEach(([, count], index) => put(`G${77 + index}`, total ? count / total : 0));
  put('C76', '%');
  put('G76', '%');
  put('A84', 'Line');
  ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'].forEach((key, index) =>
    put(`${['B', 'C', 'D', 'E'][index]}84`, key),
  );
  put('F84', 'Total');
  put('G84', 'Label grafik');
  (lineEntries.length ? lineEntries : [['Tidak ada data', 0] as const]).forEach(
    ([label, count], index) => {
      put(`A${85 + index}`, label);
      put(`G${85 + index}`, shortChartLabel(label.split(' · ')[0] ?? label));
      ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'].forEach((key, statusIndex) =>
        put(
          `${['B', 'C', 'D', 'E'][statusIndex]}${85 + index}`,
          lineStatus.get(label)?.get(key) ?? 0,
        ),
      );
      put(`F${85 + index}`, count);
    },
  );
  put('H84', 'Bulan');
  ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'].forEach((key, index) =>
    put(`${['I', 'J', 'K', 'L'][index]}84`, key),
  );
  put('M84', 'Total');
  put('N84', 'Label grafik');
  (partEntries.length ? partEntries : [['Tidak ada data', 0] as const]).forEach(([label], index) =>
    put(`N${85 + index}`, shortChartLabel(label)),
  );
  (monthEntries.length ? monthEntries : [['Tidak ada data', 0] as const]).forEach(
    ([label, count], index) => {
      put(`H${85 + index}`, label);
      ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'].forEach((key, categoryIndex) =>
        put(
          `${['I', 'J', 'K', 'L'][categoryIndex]}${85 + index}`,
          monthlyCategory.get(label)?.get(key) ?? 0,
        ),
      );
      put(`M${85 + index}`, count);
    },
  );

  for (let number = 1; number <= 96; number++) {
    const row = sheet.getRow(number);
    row.height =
      number === 1
        ? 31
        : number === 2
          ? 14
          : number === 6
            ? 34
            : number === 10 || number === 11
              ? 27
              : 22;
    for (let column = 1; column <= 16; column++) {
      const cell = row.getCell(column);
      const address = cell.address;
      if (content.has(address)) cell.value = content.get(address)!;
      if (number >= 77 && number <= 80 && (column === 3 || column === 7)) cell.numFmt = '0.0%';
      cell.font = { name: 'Aptos', size: 10, color: { argb: colors.ink } };
      cell.alignment = { vertical: 'middle', wrapText: number === 6 || number >= 67 };
      if (number <= 2)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
      if (number === 9 || number === 10 || number === 11)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } };
      if ([13, 31, 49, 67, 74, 76, 84].includes(number))
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } };
      if (number >= 77 && number % 2 === 0)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }
    if (number === 1)
      row.getCell(1).font = {
        name: 'Aptos Display',
        size: 20,
        bold: true,
        color: { argb: colors.white },
      };
    if ([4, 5, 6, 7].includes(number))
      row.getCell(1).font = { name: 'Aptos', size: 10, bold: true, color: { argb: colors.muted } };
    if ([13, 31, 49, 67, 74, 76, 84].includes(number))
      for (const column of [1, 5, 8, 9, 15])
        row.getCell(column).font = {
          name: 'Aptos Display',
          size: 11,
          bold: true,
          color: { argb: colors.navy },
        };
    if (number === 9)
      for (const column of [1, 4, 7, 10, 13])
        row.getCell(column).font = {
          name: 'Aptos',
          size: 10,
          bold: true,
          color: { argb: colors.muted },
        };
    if (number === 10)
      for (const column of [1, 4, 7, 10, 13])
        row.getCell(column).font = {
          name: 'Aptos Display',
          size: 21,
          bold: true,
          color: { argb: colors.navy },
        };
    if (number === 9 || number === 10)
      for (const column of [1, 4, 7, 10, 13])
        row.getCell(column).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    row.commit();
  }
  const chart = (
    title: string,
    direction: 'bar' | 'column',
    entries: readonly (readonly [string, number])[],
    labelColumn: string,
    valueColumn: string,
    from: ExportChart['from'],
    to: ExportChart['to'],
    color: string,
    pointColors?: string[],
  ): ExportChart => ({
    title,
    direction,
    labels: entries.length ? entries.map(([label]) => label) : ['Tidak ada data'],
    values: entries.length ? entries.map(([, count]) => count) : [0],
    labelColumn,
    valueColumn,
    firstRow: 77,
    from,
    to,
    color,
    ...(pointColors ? { pointColors } : {}),
  });
  return [
    chart(
      'Status',
      'bar',
      statusEntries,
      'A',
      'B',
      { column: 0, row: 13 },
      { column: 8, row: 29 },
      '4778D2',
      ['F59E0B', '16A34A', 'F04438', '64748B'],
    ),
    chart(
      'Kategori 4M',
      'bar',
      categoryEntries,
      'E',
      'F',
      { column: 8, row: 13 },
      { column: 16, row: 29 },
      '20A694',
    ),
    {
      ...chart(
        'Line Top 10',
        'bar',
        lineEntries,
        'G',
        'F',
        { column: 0, row: 31 },
        { column: 8, row: 47 },
        '4778D2',
      ),
      firstRow: 85,
      labels: (lineEntries.length ? lineEntries : [['Tidak ada data', 0] as const]).map(([line]) =>
        shortChartLabel(line.split(' · ')[0] ?? line),
      ),
      grouping: 'stacked',
      series: ['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED'].map((name, index) => ({
        name,
        valueColumn: ['B', 'C', 'D', 'E'][index]!,
        values: (lineEntries.length ? lineEntries : [['Tidak ada data', 0] as const]).map(
          ([line]) => lineStatus.get(line)?.get(name) ?? 0,
        ),
        color: ['F59E0B', '16A34A', 'F04438', '64748B'][index]!,
      })),
    },
    {
      ...chart(
        'Tren bulanan',
        'column',
        monthEntries,
        'H',
        'M',
        { column: 8, row: 31 },
        { column: 16, row: 47 },
        '4778D2',
      ),
      firstRow: 85,
      grouping: 'stacked',
      series: ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'].map((name, index) => ({
        name,
        valueColumn: ['I', 'J', 'K', 'L'][index]!,
        values: (monthEntries.length ? monthEntries : [['Tidak ada data', 0] as const]).map(
          ([month]) => monthlyCategory.get(month)?.get(name) ?? 0,
        ),
        color: ['4778D2', '20A694', 'F59A45', 'A78BFA'][index]!,
      })),
    },
    {
      ...chart(
        'Part Top 10',
        'bar',
        partEntries,
        'N',
        'P',
        { column: 0, row: 49 },
        { column: 8, row: 65 },
        'F59A45',
      ),
      firstRow: 85,
      labels: (partEntries.length ? partEntries : [['Tidak ada data', 0] as const]).map(([part]) =>
        shortChartLabel(part),
      ),
    },
    chart(
      'Keputusan PCR',
      'bar',
      pcrEntries,
      'I',
      'J',
      { column: 8, row: 49 },
      { column: 16, row: 65 },
      '20A694',
      ['16A34A', '4778D2', 'F59E0B', 'F04438', '94A3B8'],
    ),
  ];
}
