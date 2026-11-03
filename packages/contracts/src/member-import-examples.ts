/** Synthetic editable examples shared by the Excel and CSV member templates. */
export const MEMBER_IMPORT_EXAMPLES: readonly (readonly string[])[] = [
  ['SPV-01', 'Supervisor contoh 1', 'SUPERVISOR', '001001', 'spv.contoh', 'MemberAwal01'],
  ['LL-01', 'Line Leader contoh 1', 'LINE_LEADER', '001002', 'll.contoh', 'MemberAwal01'],
  ['QC-01', 'QC contoh 1', 'QC', '001003', 'qc.contoh', 'MemberAwal01'],
  ['SPV-02', 'Supervisor contoh 2', 'SUPERVISOR', '001004', 'spv.contoh.2', 'MemberAwal01'],
  ['LL-02', 'Line Leader contoh 2', 'LINE_LEADER', '001005', 'll.contoh.2', 'MemberAwal01'],
  ['LL-03', 'Line Leader contoh 3', 'LINE_LEADER', '001006', 'll.contoh.3', 'MemberAwal01'],
  ['QC-02', 'QC contoh 2', 'QC', '001007', 'qc.contoh.2', 'MemberAwal01'],
  ...Array.from({ length: 13 }, (_, index) => [
    `MP-${String(index + 1).padStart(2, '0')}`,
    `Operator contoh ${index + 1}`,
    'MP',
    '',
    '',
    '',
  ]),
];
