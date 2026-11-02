import { describe, expect, it } from 'vitest';
import { changeMemberRoleRequestSchema, memberRolePreviewRequestSchema } from './member-role.js';

describe('member role command contracts', () => {
  it('accepts operational targets and rejects MP, administrative roles and implicit account changes', () => {
    for (const role of ['LINE_LEADER', 'SUPERVISOR', 'QC'])
      expect(memberRolePreviewRequestSchema.safeParse({ role }).success).toBe(true);
    for (const role of ['MP', 'SUPPLIER_ADMIN', 'TMMIN_ADMIN'])
      expect(memberRolePreviewRequestSchema.safeParse({ role }).success).toBe(false);
    const command = {
      role: 'QC',
      revision: 'a'.repeat(64),
      reason: 'New assignment',
      handovers: [],
    };
    expect(changeMemberRoleRequestSchema.safeParse(command).success).toBe(true);
    expect(changeMemberRoleRequestSchema.safeParse({ ...command, active: true }).success).toBe(
      false,
    );
    expect(changeMemberRoleRequestSchema.safeParse({ ...command, reason: '   ' }).success).toBe(
      false,
    );
    expect(changeMemberRoleRequestSchema.safeParse({ ...command, revision: 'stale' }).success).toBe(
      false,
    );
  });
});
