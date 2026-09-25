import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Grid2X2,
  History,
  Info,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button, EmptyState, ErrorState, Input, NativeSelect } from '@tmmin-henkaten/ui';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import type { TanokoMapping, TanokoMatrix } from '@tmmin-henkaten/contracts';
import { supplierApi } from '../app/api';
import { useSession } from '../app/session';
import { scopedKey } from '../app/query';
import './tanoko.css';

type Job = TanokoMatrix['jobs'][number];
type Member = TanokoMatrix['members'][number];
type Selection = { job: Job; member: Member; mapping: TanokoMapping | undefined };
const levels = [
  { value: null, label: 'Belum dinilai', description: 'Belum ada penilaian untuk job ini.' },
  { value: 1, label: 'Training', description: 'Sedang mempelajari proses kerja.' },
  { value: 2, label: 'Dengan pengawasan', description: 'Bekerja dengan pendampingan.' },
  { value: 3, label: 'Mandiri', description: 'Dapat bekerja tanpa pengawasan.' },
  { value: 4, label: 'Dapat melatih', description: 'Dapat membimbing MP pada job ini.' },
] as const;
const categories = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' } as const;
const keyOf = (memberId: string, jobId: string) => `${memberId}:${jobId}`;
const columnPageSize = 24;

export function LevelMark({ level }: { level: number | null }) {
  return (
    <span
      aria-hidden="true"
      className={`tanoko-level${level === null ? ' is-empty' : ''}`}
      style={{ '--level': level ?? 0 } as CSSProperties}
    >
      {level === null ? '—' : ''}
    </span>
  );
}
function Category({ value }: { value: Job['category'] }) {
  return (
    <span className={`tanoko-category ${value?.toLowerCase() ?? 'unset'}`}>
      {value ? categories[value] : 'Belum diatur'}
    </span>
  );
}

export default function TanokoPage() {
  const { session } = useSession();
  const principal = session!.principal;
  const scope = {
    userId: principal.userId,
    supplierId: principal.supplierId!,
    purpose: principal.purpose,
  };
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get('tab') === 'history' ? 'history' : 'matrix';
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase('id'));
  const [lineId, setLineId] = useState('');
  const [category, setCategory] = useState('');
  const [memberPage, setMemberPage] = useState(0);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const lastCell = useRef<HTMLButtonElement | null>(null);
  const matrix = useQuery({
    queryKey: scopedKey(scope, 'tanoko'),
    queryFn: () => supplierApi.tanoko(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const history = useInfiniteQuery({
    queryKey: scopedKey(scope, 'tanoko-history', { search: deferredSearch, lineId }),
    queryFn: ({ pageParam }) =>
      supplierApi.tanokoHistory({
        ...(pageParam ? { cursor: pageParam } : {}),
        ...(deferredSearch ? { search: deferredSearch } : {}),
        ...(lineId ? { lineId } : {}),
        limit: 30,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: tab === 'history',
    refetchOnWindowFocus: true,
  });
  const mappings = useMemo(
    () => new Map(matrix.data?.mappings.map((m) => [keyOf(m.memberId, m.jobId), m])),
    [matrix.data],
  );
  const lines = useMemo(
    () => [
      ...new Map(
        matrix.data?.jobs.map((j) => [j.lineId, { id: j.lineId, name: j.lineName }]),
      ).values(),
    ],
    [matrix.data],
  );
  const filtered = useMemo(() => {
    const data = matrix.data;
    if (!data) return { jobs: [], members: [] };
    const jobs = data.jobs.filter(
      (j) => (!lineId || j.lineId === lineId) && (!category || j.category === category),
    );
    if (!deferredSearch) return { jobs, members: data.members };
    const matchingJobs = jobs.filter((j) =>
      `${j.name} ${j.lineName}`.toLocaleLowerCase('id').includes(deferredSearch),
    );
    const matchingMembers = data.members.filter((m) =>
      m.name.toLocaleLowerCase('id').includes(deferredSearch),
    );
    return {
      jobs: matchingJobs.length ? matchingJobs : matchingMembers.length ? jobs : [],
      members: matchingMembers.length ? matchingMembers : matchingJobs.length ? data.members : [],
    };
  }, [matrix.data, lineId, category, deferredSearch]);
  const page = Math.min(
    memberPage,
    Math.max(0, Math.ceil(filtered.members.length / columnPageSize) - 1),
  );
  const members = filtered.members.slice(page * columnPageSize, (page + 1) * columnPageSize);
  const qualifiedByJob = useMemo(() => {
    const active = new Set(matrix.data?.members.filter((m) => m.active).map((m) => m.id));
    const counts = new Map<string, number>();
    matrix.data?.mappings.forEach((m) => {
      if (active.has(m.memberId) && (m.level ?? 0) >= 3)
        counts.set(m.jobId, (counts.get(m.jobId) ?? 0) + 1);
    });
    return counts;
  }, [matrix.data]);
  const qualifiedByMember = useMemo(() => {
    const visibleJobs = new Set(filtered.jobs.filter((j) => j.active).map((j) => j.id));
    const counts = new Map<string, number>();
    matrix.data?.mappings.forEach((m) => {
      if (visibleJobs.has(m.jobId) && (m.level ?? 0) >= 3)
        counts.set(m.memberId, (counts.get(m.memberId) ?? 0) + 1);
    });
    return counts;
  }, [matrix.data, filtered.jobs]);
  const transition = (action: () => void) => {
    if (dirty) setPendingSelection(() => action);
    else action();
  };
  const close = () =>
    transition(() => {
      setSelected(null);
      setDirty(false);
      lastCell.current?.focus();
    });
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const target = new URL(anchor.href);
      if (target.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingSelection(() => () => {
        void navigate(target.pathname + target.search + target.hash);
      });
    };
    document.addEventListener('click', guard, true);
    return () => document.removeEventListener('click', guard, true);
  }, [dirty, navigate]);
  useEffect(() => {
    const listener = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener('fullscreenchange', listener);
    return () => document.removeEventListener('fullscreenchange', listener);
  }, []);
  const switchTab = (next: string) =>
    transition(() => {
      const nextParams = new URLSearchParams(params);
      if (next === 'history') nextParams.set('tab', next);
      else nextParams.delete('tab');
      setParams(nextParams);
      setSelected(null);
      setDirty(false);
    });
  const reset = () => {
    setSearch('');
    setCategory('');
    setLineId('');
    setMemberPage(0);
  };
  const moveCell = (event: KeyboardEvent<HTMLButtonElement>, row: number, column: number) => {
    const offsets: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    workspaceRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${row + offset[0]}:${column + offset[1]}"]`)
      ?.focus();
  };
  return (
    <div className="tanoko-page" ref={workspaceRef}>
      <header className="tanoko-heading">
        <div>
          <div className="tanoko-title">
            <h1>Tanoko</h1>
            <span className="tanoko-live">
              <span />
              Skill matrix
            </span>
          </div>
          <p>Pemetaan penguasaan job seluruh MP lintas line.</p>
        </div>
        <div className="tanoko-heading-actions">
          <span className="tanoko-permission">
            {matrix.data?.canEdit ? (
              <>
                <CheckCheck /> Akses edit · GL & Admin
              </>
            ) : (
              <>
                <LockKeyhole /> Hanya lihat
              </>
            )}
          </span>
          <button
            type="button"
            className="tanoko-icon-button"
            aria-label={fullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
            onClick={() => {
              void (
                fullscreen ? document.exitFullscreen() : workspaceRef.current?.requestFullscreen()
              )?.catch(() => setNotice('Layar penuh tidak tersedia pada browser ini.'));
            }}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
      </header>
      <div className="tanoko-tabs" role="tablist" aria-label="Tampilan Tanoko">
        <button
          id="tanoko-matrix-tab"
          role="tab"
          aria-selected={tab === 'matrix'}
          aria-controls="tanoko-matrix-panel"
          tabIndex={tab === 'matrix' ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              switchTab('history');
              document.getElementById('tanoko-history-tab')?.focus();
            }
          }}
          onClick={() => switchTab('matrix')}
        >
          <Grid2X2 />
          Matriks
        </button>
        <button
          id="tanoko-history-tab"
          role="tab"
          aria-selected={tab === 'history'}
          aria-controls="tanoko-history-panel"
          tabIndex={tab === 'history' ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              switchTab('matrix');
              document.getElementById('tanoko-matrix-tab')?.focus();
            }
          }}
          onClick={() => switchTab('history')}
        >
          <History />
          Riwayat
        </button>
        <span>
          {tab === 'matrix'
            ? 'Klik sel untuk melihat atau memperbarui level'
            : 'Setiap perubahan tersimpan dan dapat ditelusuri'}
        </span>
      </div>
      <div className="tanoko-toolbar">
        <label className="tanoko-search">
          <Search />
          <span className="sr-only">
            Cari {tab === 'matrix' ? 'MP atau job' : 'MP, job, atau pengubah'}
          </span>
          <Input
            placeholder={tab === 'matrix' ? 'Cari MP atau job…' : 'Cari MP, job, atau pengubah…'}
            value={search}
            maxLength={150}
            onChange={(e) => {
              setSearch(e.target.value);
              setMemberPage(0);
            }}
          />
          {search && (
            <button aria-label="Hapus pencarian" onClick={() => setSearch('')}>
              <X />
            </button>
          )}
        </label>
        <label className="tanoko-filter">
          <SlidersHorizontal />
          <span className="sr-only">Filter line</span>
          <NativeSelect
            value={lineId}
            onChange={(e) => {
              setLineId(e.target.value);
              setMemberPage(0);
            }}
          >
            <option value="">Semua line</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        {tab === 'matrix' && (
          <label className="tanoko-filter">
            <span className="sr-only">Filter kategori</span>
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Semua kategori</option>
              {Object.entries(categories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {(search || lineId || category) && (
          <button className="tanoko-clear" onClick={reset}>
            Reset filter
          </button>
        )}
        <span className="tanoko-result-count">
          {tab === 'matrix' && matrix.data ? (
            <>
              <strong>{filtered.jobs.length}</strong> job<span>·</span>
              <strong>{filtered.members.length}</strong> MP
            </>
          ) : (
            <>
              <Clock3 />
              Terbaru lebih dulu
            </>
          )}
        </span>
      </div>
      <div role="status" className={notice ? 'tanoko-notice' : 'sr-only'}>
        {notice}
        {notice && (
          <button aria-label="Tutup pemberitahuan" onClick={() => setNotice('')}>
            <X />
          </button>
        )}
      </div>
      {pendingSelection && (
        <div className="tanoko-discard" role="alert">
          <span>
            <strong>Perubahan belum disimpan.</strong> Simpan dahulu atau buang perubahan untuk
            melanjutkan.
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPendingSelection(null)}>
            Lanjut edit
          </Button>
          <Button
            size="sm"
            onClick={() => {
              pendingSelection();
              setDirty(false);
              setPendingSelection(null);
            }}
          >
            Buang perubahan
          </Button>
        </div>
      )}
      {tab === 'matrix' ? (
        <section
          role="tabpanel"
          id="tanoko-matrix-panel"
          aria-labelledby="tanoko-matrix-tab"
          className={`tanoko-workspace${selected ? ' has-inspector' : ''}`}
        >
          <div className="tanoko-matrix-area">
            {matrix.isLoading ? (
              <MatrixSkeleton />
            ) : matrix.isError ? (
              <ErrorState
                title="Matriks belum dapat dimuat"
                description="Coba muat ulang untuk mendapatkan data Tanoko terbaru."
                action={<Button onClick={() => void matrix.refetch()}>Coba lagi</Button>}
              />
            ) : !filtered.jobs.length || !filtered.members.length ? (
              <EmptyState
                title={
                  search || lineId || category
                    ? 'Tidak ada hasil yang sesuai'
                    : 'Matriks siap diisi'
                }
                description={
                  search || lineId || category
                    ? 'Coba kata kunci lain atau reset filter.'
                    : 'Tambahkan MP serta job pada Setup. Sel yang belum dinilai akan ditampilkan dengan tanda —.'
                }
                action={
                  search || lineId || category ? (
                    <Button variant="secondary" onClick={reset}>
                      Reset filter
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div
                  className="tanoko-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Matriks Tanoko, nama MP dan kolom job tetap terlihat saat menggulir"
                >
                  <table className="tanoko-table">
                    <caption className="sr-only">
                      Level penguasaan job per MP. Level 3 dan 4 memenuhi syarat skill pengganti
                      Man. Gunakan tombol panah untuk berpindah sel.
                    </caption>
                    <colgroup>
                      <col className="tanoko-line-col" />
                      <col className="tanoko-job-col" />
                      <col className="tanoko-category-col" />
                      {members.map((m) => (
                        <col key={m.id} className="tanoko-member-col" />
                      ))}
                      <col className="tanoko-total-col" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="freeze-line">
                          Line
                        </th>
                        <th scope="col" className="freeze-job">
                          Job / Skill
                        </th>
                        <th scope="col" className="freeze-category">
                          Kategori
                        </th>
                        {members.map((m) => (
                          <th
                            key={m.id}
                            scope="col"
                            className={selected?.member.id === m.id ? 'is-highlighted' : ''}
                          >
                            <span
                              className="tanoko-name"
                              tabIndex={0}
                              aria-label={`${m.name}${m.active ? '' : ' · Nonaktif'}`}
                            >
                              <span>{m.name}</span>
                              <span className="tanoko-name-tip" role="tooltip">
                                {m.name}
                                {!m.active && ' · Nonaktif'}
                              </span>
                            </span>
                            {!m.active && <small className="tanoko-inactive">Nonaktif</small>}
                          </th>
                        ))}
                        <th scope="col" title="Seluruh MP aktif dengan level 3 atau 4 pada job ini">
                          MP ≥3
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.jobs.map((job, row) => (
                        <tr
                          key={job.id}
                          className={`${row === 0 || filtered.jobs[row - 1]?.lineId !== job.lineId ? 'is-line-start ' : ''}${selected?.job.id === job.id ? 'is-selected-row' : ''}${!job.active ? ' is-inactive-row' : ''}`}
                        >
                          <td className="freeze-line">
                            <span title={job.lineName}>{job.lineCode}</span>
                          </td>
                          <th scope="row" className="freeze-job">
                            <span title={job.name}>{job.name}</span>
                            {!job.active && <small>Nonaktif</small>}
                          </th>
                          <td className="freeze-category">
                            <Category value={job.category} />
                          </td>
                          {members.map((member, column) => {
                            const mapping = mappings.get(keyOf(member.id, job.id));
                            const level = mapping?.level ?? null;
                            const active =
                              selected?.member.id === member.id && selected.job.id === job.id;
                            return (
                              <td
                                key={member.id}
                                className={
                                  selected?.member.id === member.id ? 'is-selected-column' : ''
                                }
                              >
                                <button
                                  type="button"
                                  className={`tanoko-cell${active ? ' is-selected' : ''}`}
                                  data-cell={`${row}:${column}`}
                                  aria-label={`${member.name}, ${job.name}, ${level === null ? 'belum dinilai' : `level ${level}, ${levels[level]!.label}`}`}
                                  aria-pressed={active}
                                  onKeyDown={(e) => moveCell(e, row, column)}
                                  onClick={(e) => {
                                    const button = e.currentTarget;
                                    transition(() => {
                                      lastCell.current = button;
                                      setSelected({ job, member, mapping });
                                      setDirty(false);
                                    });
                                  }}
                                >
                                  <LevelMark level={level} />
                                  <span className="tanoko-cell-number">{level ?? ''}</span>
                                </button>
                              </td>
                            );
                          })}
                          <td className="tanoko-row-total">
                            <span
                              className={(qualifiedByJob.get(job.id) ?? 0) === 0 ? 'is-zero' : ''}
                            >
                              {qualifiedByJob.get(job.id) ?? 0}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th className="freeze-summary" colSpan={3} scope="row">
                          Job dikuasai <span>level ≥3</span>
                        </th>
                        {members.map((m) => (
                          <td key={m.id}>{qualifiedByMember.get(m.id) ?? 0}</td>
                        ))}
                        <td>—</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="tanoko-table-meta">
                  <span>
                    <LockKeyhole />
                    Nama MP & job tetap terlihat
                    <span className="tanoko-meta-detail">
                      {' '}
                      · Rekap MP mencakup seluruh MP aktif
                    </span>
                  </span>
                  {filtered.members.length > columnPageSize && (
                    <div className="tanoko-column-pager">
                      <button
                        aria-label="MP sebelumnya"
                        disabled={page === 0}
                        onClick={() => setMemberPage(page - 1)}
                      >
                        <ChevronLeft />
                      </button>
                      <span>
                        {page * columnPageSize + 1}–
                        {Math.min((page + 1) * columnPageSize, filtered.members.length)} /{' '}
                        {filtered.members.length} MP
                      </span>
                      <button
                        aria-label="MP berikutnya"
                        disabled={(page + 1) * columnPageSize >= filtered.members.length}
                        onClick={() => setMemberPage(page + 1)}
                      >
                        <ChevronRight />
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {selected && (
            <SkillInspector
              key={keyOf(selected.member.id, selected.job.id)}
              selection={selected}
              canEdit={Boolean(
                matrix.data?.canEdit && selected.member.active && selected.job.active,
              )}
              onClose={close}
              onDirty={setDirty}
              onSaved={async (mapping) => {
                setSelected((current) => (current ? { ...current, mapping } : null));
                setDirty(false);
                setPendingSelection(null);
                setNotice('Mapping tersimpan. Riwayat perubahan telah diperbarui.');
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: scopedKey(scope, 'tanoko') }),
                  queryClient.invalidateQueries({
                    queryKey: [
                      'SUPPLIER',
                      scope.userId,
                      scope.supplierId,
                      scope.purpose,
                      'tanoko-history',
                    ],
                  }),
                ]);
              }}
              onReload={async () => {
                const fresh = await matrix.refetch();
                if (fresh.data) {
                  const mapping = fresh.data.mappings.find(
                    (m) => m.memberId === selected.member.id && m.jobId === selected.job.id,
                  );
                  setSelected({ ...selected, mapping });
                  return mapping;
                }
                throw new Error('Reload failed');
              }}
            />
          )}
        </section>
      ) : (
        <section
          role="tabpanel"
          id="tanoko-history-panel"
          aria-labelledby="tanoko-history-tab"
          className="tanoko-history"
        >
          <div className="tanoko-history-heading">
            <div>
              <span className="tanoko-history-icon">
                <History />
              </span>
              <div>
                <h2>Riwayat perubahan</h2>
                <p>Siapa mengubah apa, kapan, dan dari level berapa.</p>
              </div>
            </div>
            <span className="tanoko-audit-label">
              <LockKeyhole />
              Tercatat otomatis
            </span>
          </div>
          {history.isLoading ? (
            <MatrixSkeleton />
          ) : history.isError ? (
            <ErrorState
              title="Riwayat belum dapat dimuat"
              description="Coba lagi untuk melihat perubahan yang tersimpan."
              action={<Button onClick={() => void history.refetch()}>Coba lagi</Button>}
            />
          ) : !history.data?.pages[0]?.items.length ? (
            <EmptyState
              title={
                search || lineId ? 'Tidak ada perubahan yang sesuai' : 'Belum ada perubahan skill'
              }
              description={
                search || lineId
                  ? 'Ubah filter untuk melihat riwayat lainnya.'
                  : 'Perubahan level oleh GL dan Admin akan muncul di sini setelah disimpan.'
              }
            />
          ) : (
            <div
              className="tanoko-history-scroll"
              tabIndex={0}
              role="region"
              aria-label="Daftar riwayat perubahan"
            >
              <table>
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>MP & Job</th>
                    <th>Perubahan level</th>
                    <th>Diubah oleh</th>
                    <th>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.pages
                    .flatMap((p) => p.items)
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          <time dateTime={item.createdAt}>
                            {new Date(item.createdAt).toLocaleDateString('id-ID', {
                              timeZone: session!.supplier!.timezone,
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </time>
                          <small>
                            {new Date(item.createdAt).toLocaleTimeString('id-ID', {
                              timeZone: session!.supplier!.timezone,
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </td>
                        <td>
                          <strong>{item.memberName}</strong>
                          <span className="tanoko-history-job">{item.jobName}</span>
                          <small>{item.lineName}</small>
                        </td>
                        <td>
                          <div className="tanoko-change-level">
                            <span>
                              <LevelMark level={item.previousLevel} />
                              {item.previousLevel ?? '—'}
                            </span>
                            <ArrowRight />
                            <span className={(item.level ?? 0) >= 3 ? 'qualified' : ''}>
                              <LevelMark level={item.level} />
                              {item.level ?? '—'}
                            </span>
                          </div>
                          <small>{levels[item.level ?? 0]!.label}</small>
                        </td>
                        <td>
                          <span className="tanoko-history-actor">{item.actorName}</span>
                          <small>
                            {item.actorRole === 'SUPERVISOR' ? 'Group Leader' : 'Supplier Admin'}
                          </small>
                        </td>
                        <td className="tanoko-history-note">
                          {item.note || <span>Tanpa catatan</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {history.hasNextPage && (
                <div className="tanoko-load-more">
                  <Button
                    variant="secondary"
                    leadingIcon={<ArrowDown />}
                    loading={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    Muat perubahan sebelumnya
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {tab === 'matrix' && (
        <footer className="tanoko-legend">
          <div>
            <strong>Level</strong>
            {levels.map((l) => (
              <span key={l.value ?? 0}>
                <LevelMark level={l.value} />
                <span>
                  {l.value !== null && <b>{l.value} </b>}
                  {l.label}
                </span>
              </span>
            ))}
          </div>
          <p>
            <Info />
            Pengganti Man: <strong>level ≥3</strong> pada job tujuan
          </p>
        </footer>
      )}
    </div>
  );
}

function SkillInspector({
  selection,
  canEdit,
  onClose,
  onDirty,
  onSaved,
  onReload,
}: {
  selection: Selection;
  canEdit: boolean;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onSaved: (mapping: TanokoMapping) => Promise<void>;
  onReload: () => Promise<TanokoMapping | undefined>;
}) {
  const [level, setLevel] = useState<number | null>(selection.mapping?.level ?? null);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState(false);
  const header = useRef<HTMLHeadingElement>(null);
  const changed = level !== (selection.mapping?.level ?? null);
  const mutation = useMutation({
    mutationFn: () =>
      supplierApi.saveTanoko(selection.member.id, selection.job.id, {
        level,
        note,
        expectedVersion: selection.mapping?.version ?? null,
      }),
    onSuccess: async (result) => {
      setNote('');
      await onSaved(result);
    },
    onError: (error) =>
      setConflict(error instanceof ApiProblemError && error.problem.status === 409),
  });
  useEffect(() => {
    header.current?.focus();
  }, []);
  useEffect(() => {
    onDirty(changed || note.trim().length > 0);
  }, [changed, note, onDirty]);
  return (
    <aside
      className="tanoko-inspector"
      aria-labelledby="skill-inspector-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !mutation.isPending) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="tanoko-inspector-top">
        <span>
          <SlidersHorizontal />
          {canEdit ? 'Edit mapping' : 'Detail mapping'}
        </span>
        <button
          className="tanoko-icon-button"
          aria-label="Tutup editor"
          disabled={mutation.isPending}
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <div className="tanoko-inspector-body">
        <div className="tanoko-inspector-identity">
          <h2 id="skill-inspector-title" tabIndex={-1} ref={header}>
            {selection.member.name}
          </h2>
          <p className="tanoko-inspector-job">{selection.job.name}</p>
          <p className="tanoko-inspector-line">{selection.job.lineName}</p>
          <div className="tanoko-inspector-category">
            <span>Kategori job</span>
            <Category value={selection.job.category} />
          </div>
        </div>
        <form
          id="tanoko-edit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (changed && canEdit && !conflict) mutation.mutate();
          }}
        >
          <fieldset disabled={!canEdit || mutation.isPending || conflict}>
            <legend>Level penguasaan</legend>
            <p className="tanoko-field-help">Pilih kemampuan MP pada job ini.</p>
            <div className="tanoko-level-options">
              {levels.map((option) => (
                <label
                  key={option.value ?? 0}
                  className={level === option.value ? 'is-chosen' : ''}
                >
                  <input
                    type="radio"
                    name="tanoko-level"
                    checked={level === option.value}
                    onChange={() => {
                      setLevel(option.value);
                      mutation.reset();
                    }}
                  />
                  <LevelMark level={option.value} />
                  <span>
                    <strong>
                      {option.value !== null && `${option.value} · `}
                      {option.label}
                    </strong>
                    <small>{option.description}</small>
                  </span>
                  {level === option.value && <Check />}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={`tanoko-eligibility ${(level ?? 0) >= 3 ? 'is-qualified' : ''}`}>
            {(level ?? 0) >= 3 ? <CheckCheck /> : <Info />}
            <span>
              {(level ?? 0) >= 3
                ? 'Memenuhi syarat skill pengganti Man'
                : 'Belum memenuhi syarat skill pengganti Man'}
              <small>Minimal level 3 pada job tujuan.</small>
            </span>
          </div>
          <label className="tanoko-note-label" htmlFor="tanoko-note">
            Catatan perubahan <span>Opsional</span>
          </label>
          <textarea
            id="tanoko-note"
            value={note}
            maxLength={500}
            rows={3}
            disabled={!canEdit || mutation.isPending || conflict}
            placeholder="Contoh: evaluasi praktik mandiri selesai…"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="tanoko-note-count">{note.length}/500</div>
        </form>
        {mutation.isError && (
          <div className="tanoko-edit-error" role="alert">
            <strong>{conflict ? 'Mapping sudah diperbarui' : 'Perubahan belum tersimpan'}</strong>
            <p>
              {conflict
                ? 'GL atau Admin lain mengubah sel ini. Muat nilai terbaru sebelum melanjutkan.'
                : 'Periksa koneksi dan coba simpan kembali. Nilai edit Anda tetap tersedia.'}
            </p>
            {conflict && (
              <Button
                variant="secondary"
                size="sm"
                loading={reloading}
                onClick={() => {
                  setReloading(true);
                  setReloadError(false);
                  void onReload()
                    .then((mapping) => {
                      setLevel(mapping?.level ?? null);
                      setNote('');
                      setConflict(false);
                      mutation.reset();
                    })
                    .catch(() => setReloadError(true))
                    .finally(() => setReloading(false));
                }}
              >
                Muat nilai terbaru
              </Button>
            )}
            {reloadError && <p>Nilai terbaru belum dapat dimuat. Coba lagi.</p>}
          </div>
        )}
        {!canEdit && (
          <div className="tanoko-readonly">
            <LockKeyhole />
            {!selection.member.active || !selection.job.active
              ? 'MP atau job nonaktif. Riwayat tetap tersimpan.'
              : 'Perubahan hanya dapat dilakukan oleh GL dan Supplier Admin.'}
          </div>
        )}
      </div>
      <div className="tanoko-inspector-footer">
        <div className="tanoko-before">
          <span>Sebelumnya</span>
          <span>
            <LevelMark level={selection.mapping?.level ?? null} />
            {levels[selection.mapping?.level ?? 0]!.label}
          </span>
        </div>
        {canEdit && (
          <Button
            type="submit"
            form="tanoko-edit-form"
            variant="primary"
            leadingIcon={<Check />}
            loading={mutation.isPending}
            disabled={!changed || conflict}
          >
            Simpan perubahan
          </Button>
        )}
        <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>
          {canEdit ? 'Batal' : 'Tutup'}
        </Button>
        <small>
          <History />
          Perubahan dicatat dalam riwayat
        </small>
      </div>
    </aside>
  );
}

function MatrixSkeleton() {
  return (
    <div className="tanoko-skeleton" role="status" aria-label="Memuat Tanoko">
      <div />
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
