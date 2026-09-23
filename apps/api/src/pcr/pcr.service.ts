import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';

import type { Prisma, PcrAssessment } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { versionConflict } from '../administration/user-admin.service.js';
import type { MutationContext } from '../administration/mutation-context.js';
import { missing } from '../master-data/member.service.js';
import { AuditWriter } from '../persistence/audit-writer.js';
import { OutboxService } from '../persistence/outbox.service.js';
import { PrismaService } from '../persistence/prisma.service.js';
import {
  PCR_PROMPT_VERSION,
  PCR_SYSTEM_PROMPT,
  PCR_TOOL_DESCRIPTION,
  PCR_TOOL_NAME,
  PCR_TOOL_SCHEMA,
} from './pcr-prompt.js';

export const pcrModelOutputSchema = z
  .object({
    needsPcr: z.boolean(),
    confidence: z.number().min(0).max(1),
    matchedControlItems: z.array(z.number().int().min(1).max(45)).max(12),
    assessment: z.string().trim().min(1).max(4000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.needsPcr !== Boolean(value.assessment)) {
      context.addIssue({
        code: 'custom',
        path: ['assessment'],
        message: 'Assessment is required only for PCR.',
      });
    }
  });
type PcrModelOutput = z.infer<typeof pcrModelOutputSchema>;

export function decidePcrStatus(
  output: PcrModelOutput | null,
  threshold: number,
): 'PCR' | 'NO_PCR' | 'REVIEW' {
  if (!output || output.confidence < threshold) return 'REVIEW';
  return output.needsPcr ? 'PCR' : 'NO_PCR';
}

export type PcrInput = {
  category: string;
  cause: string;
  detail: string;
  affectedObject?: string | null;
  replacementObject?: string | null;
};

export function pcrInputHash(input: PcrInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        category: input.category,
        cause: input.cause,
        detail: input.detail,
        affectedObject: input.affectedObject ?? null,
        replacementObject: input.replacementObject ?? null,
      }),
    )
    .digest('hex');
}

export function presentPcrAssessment(row: PcrAssessment | null | undefined) {
  return row
    ? {
        status: row.status,
        decisionSource: row.decisionSource,
        assessment: row.status === 'PCR' ? row.assessment : null,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

type AssessmentClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PcrService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(PcrService.name);
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.pcrWorkerEnabled) this.schedule(0);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  async queueHosted(
    tx: Prisma.TransactionClient,
    henkatenId: string,
    supplierId: string,
    input: PcrInput,
  ) {
    await tx.pcrAssessment.create({
      data: {
        supplierId,
        henkatenId,
        inputHash: pcrInputHash(input),
      },
    });
  }

  async queueExternal(
    tx: Prisma.TransactionClient,
    projectionId: string,
    supplierId: string,
    input: PcrInput,
  ) {
    const hash = pcrInputHash(input);
    const existing = await tx.pcrAssessment.findUnique({
      where: { externalProjectionId: projectionId },
    });
    if (existing?.inputHash === hash) return;
    if (existing) {
      await tx.pcrAssessment.update({
        where: { id: existing.id },
        data: {
          status: 'PENDING',
          decisionSource: null,
          assessment: null,
          aiNeedsPcr: null,
          aiConfidence: null,
          aiAssessment: null,
          aiMatchedItems: [],
          model: null,
          promptVersion: null,
          inputHash: hash,
          leaseToken: null,
          leasedAt: null,
          attemptCount: 0,
          reviewedById: null,
          reviewedAt: null,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.pcrAssessment.create({
        data: { supplierId, externalProjectionId: projectionId, inputHash: hash },
      });
    }
  }

  async correct(
    kind: 'HOSTED' | 'EXTERNAL',
    supplierId: string,
    recordId: string,
    input: { status: 'PCR' | 'NO_PCR'; reason: string; expectedVersion: number },
    context: MutationContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.pcrAssessment.findFirst({
        where: {
          supplierId,
          ...(kind === 'HOSTED' ? { henkatenId: recordId } : { externalProjectionId: recordId }),
        },
      });
      let updated: PcrAssessment;
      if (!row) {
        if (input.expectedVersion !== 0) throw versionConflict();
        const evidence =
          kind === 'HOSTED'
            ? await tx.henkaten.findFirst({ where: { id: recordId, supplierId } })
            : await tx.externalHenkatenProjection.findFirst({
                where: { id: recordId, supplierId },
              });
        if (!evidence) throw missing('Henkaten');
        const change =
          kind === 'EXTERNAL' &&
          'changeSnapshot' in evidence &&
          evidence.changeSnapshot &&
          typeof evidence.changeSnapshot === 'object' &&
          !Array.isArray(evidence.changeSnapshot)
            ? (evidence.changeSnapshot as Record<string, unknown>)
            : null;
        const hash = pcrInputHash({
          category: evidence.category,
          cause: change
            ? typeof change.cause === 'string'
              ? change.cause
              : ''
            : 'cause' in evidence
              ? evidence.cause
              : '',
          detail: change
            ? typeof change.detail === 'string'
              ? change.detail
              : ''
            : 'detail' in evidence
              ? evidence.detail
              : '',
          affectedObject: change
            ? typeof change.affectedObject === 'string'
              ? change.affectedObject
              : null
            : 'affectedObject' in evidence
              ? evidence.affectedObject
              : null,
          replacementObject: change
            ? typeof change.replacementObject === 'string'
              ? change.replacementObject
              : null
            : 'replacementObject' in evidence
              ? evidence.replacementObject
              : null,
        });
        const inserted = await tx.pcrAssessment.createMany({
          data: {
            supplierId,
            ...(kind === 'HOSTED' ? { henkatenId: recordId } : { externalProjectionId: recordId }),
            inputHash: hash,
            status: input.status,
            decisionSource: 'TMMIN',
            assessment: input.status === 'PCR' ? input.reason.trim() : null,
            reviewedById: context.actorUserId,
            reviewedAt: new Date(),
          },
          skipDuplicates: true,
        });
        if (!inserted.count) throw versionConflict();
        updated = await tx.pcrAssessment.findFirstOrThrow({
          where: {
            supplierId,
            ...(kind === 'HOSTED' ? { henkatenId: recordId } : { externalProjectionId: recordId }),
          },
        });
      } else {
        if (row.version !== input.expectedVersion) throw versionConflict();
        const changed = await tx.pcrAssessment.updateMany({
          where: { id: row.id, version: input.expectedVersion },
          data: {
            status: input.status,
            decisionSource: 'TMMIN',
            assessment: input.status === 'PCR' ? input.reason.trim() : null,
            reviewedById: context.actorUserId,
            reviewedAt: new Date(),
            leaseToken: null,
            leasedAt: null,
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw versionConflict();
        updated = await tx.pcrAssessment.findUniqueOrThrow({ where: { id: row.id } });
      }
      await this.audit.write(
        {
          actorKind: 'USER',
          actorUserId: context.actorUserId,
          actorRole: context.actorRole,
          supplierId,
          action: 'PCR_DECISION_CORRECTED',
          resourceType: kind === 'HOSTED' ? 'Henkaten' : 'ExternalHenkatenProjection',
          resourceId: recordId,
          correlationId: context.correlationId,
          changeSummary: {
            from: row?.status ?? 'UNASSESSED',
            to: input.status,
            reason: input.reason.trim(),
            assessmentVersion: updated.version,
          },
        },
        tx,
      );
      await this.enqueueDecision(tx, updated, 'PCR_DECISION_CORRECTED', context.correlationId);
      return presentPcrAssessment(updated);
    });
  }

  private schedule(delay: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.processOne()
        .catch((error: unknown) => {
          this.logger.error(
            `PCR worker failure: ${error instanceof Error ? error.name : 'UnknownError'}`,
          );
        })
        .finally(() => {
          this.inFlight = undefined;
          this.schedule(this.config.pcrWorkerPollMs);
        });
    }, delay);
    this.timer.unref();
  }

  async processOne(): Promise<void> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const staleBefore = new Date(
        Date.now() - Math.max(this.config.pcrInferenceTimeoutMs * 2, 120_000),
      );
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "PcrAssessment" WHERE status = 'PENDING'
          AND ("leasedAt" IS NULL OR "leasedAt" < ${staleBefore})
        ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      if (!rows[0]) return null;
      const token = randomUUID();
      return tx.pcrAssessment.update({
        where: { id: rows[0].id },
        data: {
          leaseToken: token,
          leasedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
    });
    if (!claimed) return;
    if (claimed.attemptCount > 2) {
      await this.finish(claimed, { status: 'REVIEW', model: null, output: null });
      return;
    }
    const input = await this.loadInput(claimed);
    if (!input || pcrInputHash(input) !== claimed.inputHash) {
      await this.finish(claimed, { status: 'REVIEW', model: null, output: null });
      return;
    }
    const inference = await this.infer(input);
    const status = decidePcrStatus(inference.output, this.config.pcrConfidenceThreshold);
    await this.finish(claimed, { status, ...inference });
  }

  private async loadInput(row: PcrAssessment): Promise<PcrInput | null> {
    if (row.henkatenId) {
      const source = await this.prisma.henkaten.findUnique({ where: { id: row.henkatenId } });
      return source
        ? {
            category: source.category,
            cause: source.cause,
            detail: source.detail,
            affectedObject: source.affectedObject,
            replacementObject: source.replacementObject,
          }
        : null;
    }
    const source = await this.prisma.externalHenkatenProjection.findUnique({
      where: { id: row.externalProjectionId! },
    });
    if (
      !source ||
      !source.changeSnapshot ||
      typeof source.changeSnapshot !== 'object' ||
      Array.isArray(source.changeSnapshot)
    )
      return null;
    const change = source.changeSnapshot as Record<string, unknown>;
    return {
      category: source.category,
      cause: typeof change.cause === 'string' ? change.cause : '',
      detail: typeof change.detail === 'string' ? change.detail : '',
      affectedObject: typeof change.affectedObject === 'string' ? change.affectedObject : null,
      replacementObject:
        typeof change.replacementObject === 'string' ? change.replacementObject : null,
    };
  }

  private async infer(
    input: PcrInput,
  ): Promise<{ model: string | null; output: PcrModelOutput | null }> {
    if (!this.config.pcrOpenAiBaseUrl || !this.config.pcrOpenAiApiKey)
      return { model: null, output: null };
    const client = new OpenAI({
      apiKey: this.config.pcrOpenAiApiKey,
      baseURL: this.config.pcrOpenAiBaseUrl,
      timeout: this.config.pcrInferenceTimeoutMs,
      maxRetries: 0,
    });
    try {
      const completion = await client.chat.completions.create({
        model: this.config.pcrOpenAiModel,
        messages: [
          { role: 'system', content: PCR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Untrusted Henkaten record data (JSON):\n${JSON.stringify(input)}`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: PCR_TOOL_NAME,
              description: PCR_TOOL_DESCRIPTION,
              parameters: PCR_TOOL_SCHEMA,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: PCR_TOOL_NAME } },
        max_tokens: 8192,
        temperature: 1,
        top_p: 0.95,
        // Ling's OpenAI-compatible server accepts these provider extensions.
        ...({ top_k: 20, chat_template_kwargs: { enable_thinking: true } } as Record<
          string,
          unknown
        >),
      });
      const choice = completion.choices[0];
      const calls = choice?.message.tool_calls;
      if (
        choice?.finish_reason !== 'tool_calls' ||
        calls?.length !== 1 ||
        calls[0]?.type !== 'function' ||
        calls[0].function.name !== PCR_TOOL_NAME
      ) {
        return { model: this.config.pcrOpenAiModel, output: null };
      }
      const parsed = pcrModelOutputSchema.safeParse(JSON.parse(calls[0].function.arguments));
      return { model: this.config.pcrOpenAiModel, output: parsed.success ? parsed.data : null };
    } catch (error) {
      this.logger.warn(
        `PCR inference unavailable: ${error instanceof Error ? error.name : 'UnknownError'}`,
      );
      return { model: this.config.pcrOpenAiModel, output: null };
    }
  }

  private async finish(
    claim: PcrAssessment,
    result: {
      status: 'PCR' | 'NO_PCR' | 'REVIEW';
      model: string | null;
      output: PcrModelOutput | null;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.pcrAssessment.updateMany({
        where: {
          id: claim.id,
          status: 'PENDING',
          leaseToken: claim.leaseToken,
          inputHash: claim.inputHash,
        },
        data: {
          status: result.status,
          decisionSource: result.status === 'REVIEW' ? null : 'AI',
          assessment: result.status === 'PCR' ? (result.output?.assessment ?? null) : null,
          aiNeedsPcr: result.output?.needsPcr ?? null,
          aiConfidence: result.output?.confidence ?? null,
          aiAssessment: result.output?.assessment ?? null,
          aiMatchedItems: result.output?.matchedControlItems ?? [],
          model: result.model,
          promptVersion: PCR_PROMPT_VERSION,
          leaseToken: null,
          leasedAt: null,
          version: { increment: 1 },
        },
      });
      if (!changed.count) return;
      const current = await tx.pcrAssessment.findUniqueOrThrow({ where: { id: claim.id } });
      await this.enqueueDecision(
        tx,
        current,
        result.status === 'REVIEW' ? 'PCR_REVIEW_REQUIRED' : 'PCR_ASSESSED',
        randomUUID(),
      );
    });
  }

  private async enqueueDecision(
    tx: AssessmentClient,
    row: PcrAssessment,
    eventType: string,
    correlationId: string,
  ) {
    if (row.status === 'NO_PCR' && eventType !== 'PCR_DECISION_CORRECTED') return;
    await this.outbox.enqueue(
      {
        eventType,
        aggregateType: row.henkatenId ? 'Henkaten' : 'ExternalHenkatenProjection',
        aggregateId: row.henkatenId ?? row.externalProjectionId!,
        aggregateVersion: row.version,
        supplierId: row.supplierId,
        actor: { kind: row.decisionSource ?? 'SYSTEM' },
        correlationId,
        payload: { pcrStatus: row.status, assessmentId: row.id },
      },
      tx,
    );
  }
}
