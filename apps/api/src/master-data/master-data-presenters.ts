import type {
  ChecklistDraftItem,
  ChecklistTemplate,
  ChecklistVersion,
  ChecklistVersionItem,
  Job,
  Line,
  Member,
  MemberPhoto,
  Part,
  ShiftTemplate,
  User,
} from '../generated/prisma/client.js';

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function presentMember(
  member: Member & { users?: User[]; photos?: MemberPhoto[] },
  includeAccount = true,
  photoBase = '/api/v1/supplier/master-data/members',
) {
  const user = member.users?.[0];
  const photo = member.photos?.find(({ state }) => state === 'CURRENT');
  const photoVersion = photo ? `?v=${photo.version}` : '';
  return {
    id: member.id,
    fullName: member.fullName,
    registrationNumber: member.registrationNumber,
    role: member.role,
    active: member.active,
    initials: initials(member.fullName),
    photo: photo
      ? {
          id: photo.id,
          fullUrl: `${photoBase}/${member.id}/photo/full${photoVersion}`,
          thumbnailUrl: `${photoBase}/${member.id}/photo/thumbnail${photoVersion}`,
          version: photo.version,
        }
      : null,
    ...(includeAccount && user
      ? {
          account: {
            id: user.id,
            username: user.username,
            status: user.status,
            mustChangePassword: user.mustChangePassword,
            version: user.version,
          },
        }
      : {}),
    version: member.version,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}

export const presentLine = (line: Line) => ({
  id: line.id,
  code: line.code,
  name: line.name,
  displayOrder: line.displayOrder,
  active: line.active,
  version: line.version,
  createdAt: line.createdAt.toISOString(),
  updatedAt: line.updatedAt.toISOString(),
});

export const presentJob = (job: Job) => ({
  id: job.id,
  lineId: job.lineId,
  name: job.name,
  displayOrder: job.displayOrder,
  active: job.active,
  version: job.version,
  createdAt: job.createdAt.toISOString(),
  updatedAt: job.updatedAt.toISOString(),
});

export const presentPart = (part: Part) => ({
  id: part.id,
  partNumber: part.partNumber,
  partName: part.partName,
  active: part.active,
  version: part.version,
  createdAt: part.createdAt.toISOString(),
  updatedAt: part.updatedAt.toISOString(),
});

export const minuteToTime = (minute: number) =>
  `${Math.floor(minute / 60)
    .toString()
    .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;

export const presentShiftTemplate = (shift: ShiftTemplate) => ({
  id: shift.id,
  name: shift.name,
  displayOrder: shift.displayOrder,
  startTime: minuteToTime(shift.startMinute),
  endTime: minuteToTime(shift.endMinute),
  timezone: shift.timezone,
  crossesMidnight: shift.endMinute < shift.startMinute,
  active: shift.active,
  version: shift.version,
  createdAt: shift.createdAt.toISOString(),
  updatedAt: shift.updatedAt.toISOString(),
});

export function presentChecklistDraft(
  template: ChecklistTemplate & { draftItems: ChecklistDraftItem[] },
) {
  return {
    templateId: template.id,
    category: template.category,
    active: template.active,
    items: template.draftItems.map((item) => ({
      id: item.id,
      label: item.label,
      displayOrder: item.displayOrder,
    })),
    version: template.version,
  };
}

export function presentChecklistVersion(
  version: ChecklistVersion & { items: ChecklistVersionItem[] },
) {
  return {
    id: version.id,
    category: version.category,
    versionNumber: version.versionNumber,
    publishedAt: version.publishedAt.toISOString(),
    items: version.items.map((item) => ({
      id: item.id,
      label: item.label,
      displayOrder: item.displayOrder,
    })),
  };
}
