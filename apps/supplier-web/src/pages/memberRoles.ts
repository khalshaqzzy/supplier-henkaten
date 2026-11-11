import type { MemberRole } from '@tmmin-henkaten/contracts';

export const memberRoleLabels: Record<MemberRole, string> = {
  MP: 'MP',
  LINE_LEADER: 'Line Leader',
  SUPERVISOR: 'Supervisor',
  QC: 'QC',
};

export const memberRoleDescriptions: Record<MemberRole, string> = {
  MP: 'Operator produksi',
  LINE_LEADER: 'Input dan tindak lanjut Henkaten',
  SUPERVISOR: 'Approval sesuai penugasan',
  QC: 'Approval kualitas supplier',
};
