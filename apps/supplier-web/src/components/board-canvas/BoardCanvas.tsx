import Konva from 'konva';
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Copy,
  Expand,
  Focus,
  Lock,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';

import type {
  BoardLayoutDocument,
  BoardLayoutNode,
  BoardMachineAssetKey,
  HenkatenCategory,
} from '@tmmin-henkaten/contracts';
import { ApiProblemError } from '@tmmin-henkaten/api-client';
import { Alert, Button, EmptyState, ErrorState, Skeleton } from '@tmmin-henkaten/ui';

import { supplierApi, supplierAssetUrl } from '../../app/api';
import { scopedKey } from '../../app/query';
import { useSession } from '../../app/session';
import { machineAssetDisplayLabel, machineAssets, machineAssetsByKey } from './machineAssets';

type BoardLine = Awaited<ReturnType<typeof supplierApi.board>>['lines'][number];
type BoardJob = BoardLine['jobs'][number];
type Transform = BoardLayoutNode['transform'];

const GRID = 10;
const HISTORY_LIMIT = 50;
const VIEWPORT_HEIGHT = 720;
const categoryColors: Record<HenkatenCategory, string> = {
  MAN: '#d92d20',
  MACHINE: '#2f6fed',
  MATERIAL: '#eaaa08',
  METHOD: '#2f8f4e',
};

export default function BoardCanvas({
  line,
  onDirtyChange,
}: {
  line: BoardLine;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    Math.max(320, Math.min(900, window.innerWidth - 40)),
  );
  const [draft, setDraft] = useState<BoardLayoutDocument | null>(null);
  const [savedDocument, setSavedDocument] = useState<BoardLayoutDocument | null>(null);
  const [past, setPast] = useState<BoardLayoutDocument[]>([]);
  const [future, setFuture] = useState<BoardLayoutDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [stagePosition, setStagePosition] = useState({ x: 16, y: 16 });
  const [saveConflict, setSaveConflict] = useState(false);
  const [editorViewport, setEditorViewport] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  );
  const scope = useMemo(
    () => ({
      userId: session!.principal.userId,
      supplierId: session!.supplier!.id,
      purpose: session!.principal.purpose,
    }),
    [session],
  );
  const layoutKey = useMemo(
    () => scopedKey(scope, 'assignment-board-layout', { lineId: line.lineId }),
    [line.lineId, scope],
  );
  const layout = useQuery({
    queryKey: layoutKey,
    queryFn: () => supplierApi.boardLayout(line.lineId),
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportWidth(Math.max(320, Math.floor(entry.contentRect.width)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setEditorViewport(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const fitView = useCallback(
    (document: BoardLayoutDocument | null = draft) => {
      if (!document) return;
      const nextScale = Math.min(
        1,
        (viewportWidth - 32) / document.canvas.width,
        (VIEWPORT_HEIGHT - 32) / document.canvas.height,
      );
      setScale(Math.max(0.25, nextScale));
      setStagePosition({ x: 16, y: 16 });
    },
    [draft, viewportWidth],
  );

  useEffect(() => {
    if (!layout.data || editing) return;
    setDraft(layout.data.document);
    setSavedDocument(layout.data.document);
    setPast([]);
    setFuture([]);
    setSaveConflict(false);
    fitView(layout.data.document);
  }, [editing, fitView, layout.data]);

  const save = useMutation({
    mutationFn: (document: BoardLayoutDocument) =>
      supplierApi.saveBoardLayout(line.lineId, {
        expectedVersion: layout.data?.version ?? null,
        document,
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(layoutKey, response);
      setDraft(response.document);
      setSavedDocument(response.document);
      setPast([]);
      setFuture([]);
      setEditing(false);
      setSelectedId(null);
      setSaveConflict(false);
    },
    onError: (error) => {
      if (error instanceof ApiProblemError && error.problem.code === 'VERSION_CONFLICT') {
        setSaveConflict(true);
      }
    },
  });

  const dirty = useMemo(
    () =>
      Boolean(draft && savedDocument && JSON.stringify(draft) !== JSON.stringify(savedDocument)),
    [draft, savedDocument],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const warnLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
      if (window.confirm('Keluar dan buang perubahan layout yang belum disimpan?')) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', warnLink, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', warnLink, true);
    };
  }, [dirty]);

  const commit = useCallback(
    (next: BoardLayoutDocument) => {
      if (!draft) return;
      setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), draft]);
      setDraft(next);
      setFuture([]);
    },
    [draft],
  );

  const updateNode = useCallback(
    (id: string, update: (node: BoardLayoutNode) => BoardLayoutNode) => {
      if (!draft) return;
      commit({
        ...draft,
        nodes: draft.nodes.map((node) => (node.id === id ? update(node) : node)),
      });
    },
    [commit, draft],
  );

  const updateTransform = useCallback(
    (id: string, transform: Transform) =>
      updateNode(id, (node) => ({ ...node, transform: boundedTransform(transform, draft!) })),
    [draft, updateNode],
  );

  const undo = () => {
    const previous = past.at(-1);
    if (!previous || !draft) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [draft, ...items].slice(0, HISTORY_LIMIT));
    setDraft(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next || !draft) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, draft].slice(-HISTORY_LIMIT));
    setDraft(next);
  };

  const selected = draft?.nodes.find(({ id }) => id === selectedId) ?? null;
  const jobsById = useMemo(() => new Map(line.jobs.map((job) => [job.jobId, job])), [line.jobs]);

  const addNode = (node: BoardLayoutNode) => {
    if (!draft) return;
    commit({ ...draft, nodes: [...draft.nodes, node] });
    setSelectedId(node.id);
  };

  useEffect(() => {
    if (!editing || !selected || selected.transform.locked) return;
    const moveWithKeyboard = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      const distance = event.shiftKey ? 1 : GRID;
      const delta =
        event.key === 'ArrowLeft'
          ? { x: -distance, y: 0 }
          : event.key === 'ArrowRight'
            ? { x: distance, y: 0 }
            : event.key === 'ArrowUp'
              ? { x: 0, y: -distance }
              : event.key === 'ArrowDown'
                ? { x: 0, y: distance }
                : null;
      if (!delta) return;
      event.preventDefault();
      updateTransform(selected.id, {
        ...selected.transform,
        x: selected.transform.x + delta.x,
        y: selected.transform.y + delta.y,
      });
    };
    window.addEventListener('keydown', moveWithKeyboard);
    return () => window.removeEventListener('keydown', moveWithKeyboard);
  }, [editing, selected, updateTransform]);

  const addMachine = (assetKey: BoardMachineAssetKey) => {
    if (!draft) return;
    const asset = machineAssetsByKey.get(assetKey)!;
    addNode({
      id: id('machine'),
      type: 'MACHINE_ASSET',
      assetKey,
      opacity: 1,
      transform: defaultTransform(draft, asset.defaultSize.width, asset.defaultSize.height),
    });
  };

  const addPrimitive = (type: 'RECTANGLE' | 'OUTLINE' | 'ARROW' | 'TEXT') => {
    if (!draft) return;
    const transform = defaultTransform(
      draft,
      type === 'TEXT' ? 320 : 420,
      type === 'TEXT' ? 80 : 220,
    );
    if (type === 'ARROW') {
      addNode({ id: id('arrow'), type, color: '#2367c9', strokeWidth: 8, transform });
    } else if (type === 'TEXT') {
      addNode({
        id: id('text'),
        type,
        text: 'Process zone',
        color: '#172033',
        fontSize: 36,
        align: 'center',
        transform,
      });
    } else {
      addNode({
        id: id(type.toLowerCase()),
        type,
        fill: '#eef4ff',
        stroke: '#2367c9',
        strokeWidth: 4,
        opacity: type === 'OUTLINE' ? 0.25 : 0.7,
        cornerRadius: 24,
        transform,
      });
    }
  };

  const deleteSelected = () => {
    if (!draft || !selected || selected.type === 'JOB_SLOT') return;
    commit({ ...draft, nodes: draft.nodes.filter(({ id }) => id !== selected.id) });
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!draft || !selected || selected.type === 'JOB_SLOT') return;
    const duplicate = {
      ...selected,
      id: id(selected.type.toLowerCase()),
      transform: boundedTransform(
        {
          ...selected.transform,
          x: selected.transform.x + 40,
          y: selected.transform.y + 40,
          zIndex: draft.nodes.length + 1,
        },
        draft,
      ),
    } as BoardLayoutNode;
    addNode(duplicate);
  };

  const reorder = (direction: -1 | 1) => {
    if (!draft || !selected) return;
    updateTransform(selected.id, {
      ...selected.transform,
      zIndex: Math.max(0, Math.min(2_000, selected.transform.zIndex + direction)),
    });
  };

  const discard = () => {
    if (dirty && !window.confirm('Buang perubahan layout yang belum disimpan?')) return;
    setDraft(savedDocument);
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setEditing(false);
    setSaveConflict(false);
  };

  const reset = () => {
    if (!layout.data) return;
    const jobs = [...line.jobs].sort((a, b) => a.displayOrder - b.displayOrder);
    const nodes: BoardLayoutNode[] = jobs.map((job, index) => ({
      id: `job:${job.jobId}`,
      type: 'JOB_SLOT',
      jobId: job.jobId,
      transform: {
        x: 100 + (index % 4) * 570,
        y: 140 + Math.floor(index / 4) * 250,
        width: 360,
        height: 190,
        rotation: 0,
        zIndex: 10 + index,
        locked: false,
      },
    }));
    commit({ ...layout.data.document, nodes });
    setSelectedId(null);
  };

  const resizeCanvas = (field: 'width' | 'height', value: number) => {
    if (!draft) return;
    const minimum = field === 'width' ? 2_400 : 1_350;
    const maximum = field === 'width' ? 12_000 : 8_000;
    const occupied = draft.nodes.reduce(
      (edge, node) =>
        Math.max(
          edge,
          field === 'width'
            ? node.transform.x + node.transform.width
            : node.transform.y + node.transform.height,
        ),
      minimum,
    );
    commit({
      ...draft,
      canvas: {
        ...draft.canvas,
        [field]: Math.ceil(Math.max(occupied, Math.min(maximum, value)) / GRID) * GRID,
      },
    });
  };

  if (layout.isError) {
    return (
      <ErrorState
        title="Canvas layout tidak dapat dimuat"
        description="Coba ambil ulang layout line ini."
        action={<Button onClick={() => void layout.refetch()}>Coba lagi</Button>}
      />
    );
  }
  if (layout.isLoading || !draft || !layout.data) return <CanvasSkeleton />;
  const layoutData = layout.data;

  return (
    <section
      className={`board-canvas-shell${editing ? ' is-editing' : ''}`}
      aria-label={`Canvas ${line.lineCode} ${line.lineName}`}
    >
      <header className="board-canvas-toolbar">
        <div>
          <strong>
            {line.lineCode} · {line.lineName}
          </strong>
          <small>
            {layoutData.source === 'SAVED'
              ? `Layout v${layoutData.version}`
              : 'Auto-layout belum disimpan'}
          </small>
        </div>
        <div className="board-canvas-toolbar__controls">
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Minus />}
            aria-label="Perkecil"
            onClick={() => setScale((value) => Math.max(0.25, value - 0.1))}
          />
          <span>{Math.round(scale * 100)}%</span>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Plus />}
            aria-label="Perbesar"
            onClick={() => setScale((value) => Math.min(2, value + 0.1))}
          />
          <Button size="sm" variant="ghost" leadingIcon={<Focus />} onClick={() => fitView()}>
            Auto-fit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Expand />}
            onClick={() => void containerRef.current?.requestFullscreen()}
          >
            Fullscreen
          </Button>
          {layoutData.canEdit && editorViewport && !editing && (
            <Button size="sm" leadingIcon={<MousePointer2 />} onClick={() => setEditing(true)}>
              Edit layout
            </Button>
          )}
          {editing && (
            <>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Undo2 />}
                disabled={!past.length}
                onClick={undo}
              >
                Undo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Redo2 />}
                disabled={!future.length}
                onClick={redo}
              >
                Redo
              </Button>
              <Button size="sm" variant="secondary" onClick={discard}>
                Batal
              </Button>
              <Button
                size="sm"
                leadingIcon={<Save />}
                loading={save.isPending}
                disabled={!dirty}
                onClick={() => void save.mutate(draft)}
              >
                Simpan
              </Button>
            </>
          )}
        </div>
      </header>
      {saveConflict && (
        <Alert tone="warning" title="Layout telah berubah di sesi lain">
          Draft Anda tetap tersedia. Muat layout terbaru atau pertahankan draft untuk membandingkan
          posisi.
          <Button size="sm" variant="ghost" onClick={() => setSaveConflict(false)}>
            Pertahankan draft
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              void layout.refetch();
            }}
          >
            Muat versi terbaru
          </Button>
        </Alert>
      )}
      {save.isError && !saveConflict && (
        <Alert tone="danger" title="Layout belum tersimpan">
          {save.error.message}
        </Alert>
      )}
      {layoutData.reconciliation.addedJobIds.length > 0 && (
        <Alert tone="info" title="Job baru ditempatkan otomatis">
          {layoutData.reconciliation.addedJobIds.length} job wajib ditambahkan ke overflow grid.
        </Alert>
      )}
      <div className="board-canvas-layout">
        {editing && <Palette onPrimitive={addPrimitive} onMachine={addMachine} />}
        <div className="board-canvas-viewport" ref={containerRef}>
          <Stage
            ref={stageRef}
            width={viewportWidth}
            height={VIEWPORT_HEIGHT}
            scaleX={scale}
            scaleY={scale}
            x={stagePosition.x}
            y={stagePosition.y}
            draggable={!editing}
            onDragEnd={(event) => setStagePosition({ x: event.target.x(), y: event.target.y() })}
            onWheel={(event) => {
              event.evt.preventDefault();
              setScale((value) =>
                Math.max(0.25, Math.min(2, value * (event.evt.deltaY > 0 ? 0.9 : 1.1))),
              );
            }}
            onMouseDown={(event) => {
              if (event.target === event.target.getStage()) setSelectedId(null);
            }}
          >
            <Layer listening={false}>
              <CanvasBackground document={draft} />
            </Layer>
            <Layer>
              {[...draft.nodes]
                .sort((a, b) => a.transform.zIndex - b.transform.zIndex)
                .map((node) => (
                  <CanvasNode
                    key={node.id}
                    node={node}
                    {...(node.type === 'JOB_SLOT' && jobsById.get(node.jobId)
                      ? { job: jobsById.get(node.jobId)! }
                      : {})}
                    editing={editing}
                    selected={selectedId === node.id}
                    onSelect={() => setSelectedId(node.id)}
                    onTransform={(transform) => updateTransform(node.id, transform)}
                  />
                ))}
            </Layer>
          </Stage>
        </div>
        {editing && (
          <Inspector
            document={draft}
            selected={selected}
            jobsById={jobsById}
            onSelect={setSelectedId}
            onTransform={(transform) => selected && updateTransform(selected.id, transform)}
            onText={(text) =>
              selected &&
              updateNode(selected.id, (node) => (node.type === 'TEXT' ? { ...node, text } : node))
            }
            onLock={() =>
              selected &&
              updateTransform(selected.id, {
                ...selected.transform,
                locked: !selected.transform.locked,
              })
            }
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onReorder={reorder}
            onReset={reset}
            onCanvasResize={resizeCanvas}
          />
        )}
      </div>
      <FourMLegend />
    </section>
  );
}

function Palette({
  onPrimitive,
  onMachine,
}: {
  onPrimitive: (type: 'RECTANGLE' | 'OUTLINE' | 'ARROW' | 'TEXT') => void;
  onMachine: (key: BoardMachineAssetKey) => void;
}) {
  return (
    <aside className="board-canvas-palette" aria-label="Asset palette">
      <h3>Assets</h3>
      <button onClick={() => onPrimitive('RECTANGLE')}>
        <Square /> Rectangle
      </button>
      <button onClick={() => onPrimitive('OUTLINE')}>
        <Box /> Outline
      </button>
      <button onClick={() => onPrimitive('ARROW')}>
        <ArrowUp /> Arrow
      </button>
      <button onClick={() => onPrimitive('TEXT')}>
        <Type /> Text
      </button>
      <h4>Machines · Isometric</h4>
      {machineAssets
        .filter(({ style }) => style === 'ISOMETRIC')
        .map((asset) => (
          <button
            key={asset.key}
            aria-label={machineAssetDisplayLabel(asset)}
            onClick={() => onMachine(asset.key)}
          >
            <img src={asset.src} alt="" />
            {asset.label}
          </button>
        ))}
      <h4>Machines · 2D Simple</h4>
      {machineAssets
        .filter(({ style }) => style === 'SIMPLE_2D')
        .map((asset) => (
          <button
            key={asset.key}
            aria-label={machineAssetDisplayLabel(asset)}
            onClick={() => onMachine(asset.key)}
          >
            <img src={asset.src} alt="" />
            {asset.label}
          </button>
        ))}
    </aside>
  );
}

function Inspector({
  document,
  selected,
  jobsById,
  onSelect,
  onTransform,
  onText,
  onLock,
  onDuplicate,
  onDelete,
  onReorder,
  onReset,
  onCanvasResize,
}: {
  document: BoardLayoutDocument;
  selected: BoardLayoutNode | null;
  jobsById: Map<string, BoardJob>;
  onSelect: (id: string) => void;
  onTransform: (value: Transform) => void;
  onText: (text: string) => void;
  onLock: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (direction: -1 | 1) => void;
  onReset: () => void;
  onCanvasResize: (field: 'width' | 'height', value: number) => void;
}) {
  return (
    <aside className="board-canvas-inspector" aria-label="Layers dan properties">
      <div className="board-canvas-layers">
        <h3>Layers</h3>
        {[...document.nodes]
          .sort((a, b) => b.transform.zIndex - a.transform.zIndex)
          .map((node) => (
            <button
              key={node.id}
              className={selected?.id === node.id ? 'is-selected' : ''}
              onClick={() => onSelect(node.id)}
            >
              <span>{nodeLabel(node, jobsById)}</span>
              {node.transform.locked ? <Lock /> : null}
            </button>
          ))}
      </div>
      {selected ? (
        <div className="board-canvas-properties">
          <h3>Properties</h3>
          <div className="board-property-grid">
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <label key={field}>
                <span>{field}</span>
                <input
                  type="number"
                  step={GRID}
                  value={Math.round(selected.transform[field])}
                  onChange={(event) =>
                    onTransform({ ...selected.transform, [field]: Number(event.target.value) })
                  }
                />
              </label>
            ))}
            {selected.type !== 'JOB_SLOT' && (
              <label>
                <span>rotation</span>
                <input
                  type="number"
                  step="15"
                  value={Math.round(selected.transform.rotation)}
                  onChange={(event) =>
                    onTransform({ ...selected.transform, rotation: Number(event.target.value) })
                  }
                />
              </label>
            )}
          </div>
          {selected.type === 'TEXT' && (
            <label className="board-property-text">
              <span>Text</span>
              <input
                value={selected.text}
                maxLength={200}
                onChange={(event) => onText(event.target.value)}
              />
            </label>
          )}
          <div className="board-property-actions">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={selected.transform.locked ? <Unlock /> : <Lock />}
              onClick={onLock}
            >
              {selected.transform.locked ? 'Unlock' : 'Lock'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<ArrowUp />}
              onClick={() => onReorder(1)}
            >
              Naik
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<ArrowDown />}
              onClick={() => onReorder(-1)}
            >
              Turun
            </Button>
            {selected.type !== 'JOB_SLOT' && (
              <>
                <Button size="sm" variant="ghost" leadingIcon={<Copy />} onClick={onDuplicate}>
                  Duplikat
                </Button>
                <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={onDelete}>
                  Hapus
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          title="Pilih satu asset"
          description="Gunakan canvas atau Layers untuk mengubah posisi dan ukuran."
        />
      )}
      <div className="board-canvas-properties">
        <h3>Canvas</h3>
        <div className="board-property-grid">
          {(['width', 'height'] as const).map((field) => (
            <label key={field}>
              <span>{field}</span>
              <input
                type="number"
                step="100"
                value={document.canvas[field]}
                onChange={(event) => onCanvasResize(field, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      </div>
      <Button size="sm" variant="ghost" leadingIcon={<RotateCcw />} onClick={onReset}>
        Reset auto-layout
      </Button>
    </aside>
  );
}

function CanvasBackground({ document }: { document: BoardLayoutDocument }) {
  const lines = [];
  if (document.canvas.background === 'LIGHT_GRID') {
    for (let x = 0; x <= document.canvas.width; x += 50)
      lines.push(
        <Line
          key={`x-${x}`}
          points={[x, 0, x, document.canvas.height]}
          stroke="#e8edf5"
          strokeWidth={1}
        />,
      );
    for (let y = 0; y <= document.canvas.height; y += 50)
      lines.push(
        <Line
          key={`y-${y}`}
          points={[0, y, document.canvas.width, y]}
          stroke="#e8edf5"
          strokeWidth={1}
        />,
      );
  }
  return (
    <>
      <Rect
        x={0}
        y={0}
        width={document.canvas.width}
        height={document.canvas.height}
        fill="#f8fafc"
        stroke="#cfd7e4"
        strokeWidth={2}
      />
      {lines}
    </>
  );
}

function CanvasNode({
  node,
  job,
  editing,
  selected,
  onSelect,
  onTransform,
}: {
  node: BoardLayoutNode;
  job?: BoardJob;
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onTransform: (value: Transform) => void;
}) {
  const shapeRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  useEffect(() => {
    if (selected && shapeRef.current && transformerRef.current)
      transformerRef.current.nodes([shapeRef.current]);
  }, [selected]);
  const props = {
    ref: shapeRef,
    x: node.transform.x,
    y: node.transform.y,
    width: node.transform.width,
    height: node.transform.height,
    rotation: node.transform.rotation,
    draggable: editing && !node.transform.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) =>
      onTransform({ ...node.transform, x: snap(event.target.x()), y: snap(event.target.y()) }),
    onTransformEnd: () => {
      const target = shapeRef.current;
      if (!target) return;
      const width = Math.max(
        node.type === 'JOB_SLOT' ? 260 : 40,
        node.transform.width * target.scaleX(),
      );
      const height = Math.max(
        node.type === 'JOB_SLOT' ? 140 : 40,
        node.transform.height * target.scaleY(),
      );
      target.scaleX(1);
      target.scaleY(1);
      onTransform({
        ...node.transform,
        x: snap(target.x()),
        y: snap(target.y()),
        width: snap(width),
        height: snap(height),
        rotation: node.type === 'JOB_SLOT' ? 0 : snapRotation(target.rotation()),
      });
    },
  };
  let rendered;
  if (node.type === 'JOB_SLOT') rendered = <JobCardNode {...props} {...(job ? { job } : {})} />;
  else if (node.type === 'MACHINE_ASSET')
    rendered = <MachineNode {...props} assetKey={node.assetKey} opacity={node.opacity} />;
  else if (node.type === 'ARROW')
    rendered = (
      <Group {...props}>
        <Arrow
          points={[0, node.transform.height / 2, node.transform.width, node.transform.height / 2]}
          stroke={node.color}
          fill={node.color}
          strokeWidth={node.strokeWidth}
          pointerLength={24}
          pointerWidth={24}
        />
      </Group>
    );
  else if (node.type === 'TEXT')
    rendered = (
      <Group {...props}>
        <Text
          text={node.text}
          width={node.transform.width}
          height={node.transform.height}
          fontSize={node.fontSize}
          fill={node.color}
          align={node.align}
          verticalAlign="middle"
          fontStyle="bold"
        />
      </Group>
    );
  else
    rendered = (
      <Group {...props}>
        <Rect
          width={node.transform.width}
          height={node.transform.height}
          fill={node.type === 'OUTLINE' ? 'transparent' : node.fill}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          opacity={node.opacity}
          cornerRadius={node.cornerRadius}
          {...(node.type === 'OUTLINE' ? { dash: [16, 10] } : {})}
        />
      </Group>
    );
  return (
    <>
      {rendered}
      {selected && editing && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={node.type !== 'JOB_SLOT'}
          flipEnabled={false}
          keepRatio={node.type === 'MACHINE_ASSET'}
          enabledAnchors={
            node.type === 'ARROW'
              ? ['middle-left', 'middle-right']
              : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          }
          anchorSize={16}
          borderStroke="#2367c9"
        />
      )}
    </>
  );
}

function JobCardNode({ job, ...props }: { job?: BoardJob } & ComponentProps<typeof Group>) {
  const mpVisual = resolveBoardMpVisual(job?.mp);
  const photo = useCanvasImage(mpVisual.photoSource);
  const width = Number(props.width);
  const height = Number(props.height);
  const state = job?.state ?? 'VACANT';
  const accent = state === 'ASSIGNED' ? '#2f8f4e' : state === 'RESERVED' ? '#d97706' : '#d92d20';
  return (
    <Group {...props}>
      <Rect
        width={width}
        height={height}
        fill="#ffffff"
        stroke={accent}
        strokeWidth={4}
        cornerRadius={20}
        shadowColor="#172033"
        shadowOpacity={0.14}
        shadowBlur={18}
        shadowOffsetY={6}
      />
      <Rect width={12} height={height} fill={accent} cornerRadius={[20, 0, 0, 20]} />
      <Text
        x={28}
        y={22}
        width={width - 150}
        text={job?.jobName ?? 'Job unavailable'}
        fontSize={25}
        fontStyle="bold"
        fill="#172033"
      />
      <Rect
        x={width - 118}
        y={18}
        width={94}
        height={30}
        fill={`${accent}18`}
        stroke={accent}
        strokeWidth={1.5}
        cornerRadius={15}
      />
      <Text
        x={width - 113}
        y={25}
        width={84}
        align="center"
        text={`${state === 'ASSIGNED' ? '✓' : '!'} ${humanize(state)}`}
        fontSize={13}
        fontStyle="bold"
        fill={accent}
      />
      <Circle x={62} y={105} radius={34} fill="#e9eef7" />
      {photo ? (
        <KonvaImage image={photo} x={28} y={71} width={68} height={68} cornerRadius={34} />
      ) : (
        <Text
          x={28}
          y={91}
          width={68}
          align="center"
          text={mpVisual.fallback}
          fontSize={24}
          fontStyle="bold"
          fill="#526176"
        />
      )}
      <Text
        x={112}
        y={78}
        width={width - 140}
        text={job?.mp.name ?? 'Vacant'}
        fontSize={20}
        fontStyle="bold"
        fill="#263246"
      />
      <Text
        x={112}
        y={108}
        width={width - 140}
        text={job?.mp.registrationNumber ?? humanize(state)}
        fontSize={16}
        fill="#667085"
      />
      {(job?.indicators ?? []).map((indicator, index) => (
        <Circle
          key={indicator.henkatenId}
          x={width - 34 - index * 24}
          y={height - 24}
          radius={8}
          fill={categoryColors[indicator.category]}
          stroke={indicator.status === 'OPEN' ? '#172033' : '#ffffff'}
          strokeWidth={indicator.status === 'OPEN' ? 2 : 1}
        />
      ))}
    </Group>
  );
}

function MachineNode({
  assetKey,
  opacity,
  ...props
}: { assetKey: BoardMachineAssetKey; opacity: number } & ComponentProps<typeof Group>) {
  const asset = machineAssetsByKey.get(assetKey)!;
  const image = useCanvasImage(asset.src);
  return (
    <Group {...props} opacity={opacity}>
      {image && (
        <KonvaImage image={image} width={Number(props.width)} height={Number(props.height)} />
      )}
    </Group>
  );
}

function FourMLegend() {
  return (
    <div className="board-canvas-4m" aria-label="Legenda 4M">
      {(['MAN', 'MACHINE', 'MATERIAL', 'METHOD'] as const).map((category) => (
        <span key={category}>
          <i style={{ background: categoryColors[category] }} />
          {humanize(category)}
        </span>
      ))}
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="board-canvas-skeleton">
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}

function useCanvasImage(src: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    const next = new Image();
    next.crossOrigin = 'use-credentials';
    next.onload = () => setImage(next);
    next.onerror = () => setImage(null);
    next.src = src;
    return () => {
      next.onload = null;
      next.onerror = null;
    };
  }, [src]);
  return image;
}

function defaultTransform(document: BoardLayoutDocument, width: number, height: number): Transform {
  return {
    x: snap(Math.min(document.canvas.width - width, 180 / 0.5)),
    y: snap(Math.min(document.canvas.height - height, 140 / 0.5)),
    width,
    height,
    rotation: 0,
    zIndex: document.nodes.length + 20,
    locked: false,
  };
}

export function boundedTransform(value: Transform, document: BoardLayoutDocument): Transform {
  const width = Math.min(document.canvas.width, Math.max(20, snap(value.width)));
  const height = Math.min(document.canvas.height, Math.max(20, snap(value.height)));
  return {
    ...value,
    x: Math.max(0, Math.min(document.canvas.width - width, snap(value.x))),
    y: Math.max(0, Math.min(document.canvas.height - height, snap(value.y))),
    width,
    height,
    rotation: Math.max(-360, Math.min(360, value.rotation)),
    zIndex: Math.max(0, Math.min(2_000, value.zIndex)),
  };
}

export function resolveBoardMpVisual(mp: BoardJob['mp'] | undefined) {
  return {
    photoSource: mp?.photoThumbnailUrl ? supplierAssetUrl(mp.photoThumbnailUrl) : null,
    fallback: mp?.initials ?? '—',
  };
}

function nodeLabel(node: BoardLayoutNode, jobs: Map<string, BoardJob>) {
  if (node.type === 'JOB_SLOT') return `Job · ${jobs.get(node.jobId)?.jobName ?? node.jobId}`;
  if (node.type === 'MACHINE_ASSET') {
    const asset = machineAssetsByKey.get(node.assetKey);
    return asset ? machineAssetDisplayLabel(asset) : node.assetKey;
  }
  if (node.type === 'TEXT') return `Text · ${node.text}`;
  return humanize(node.type);
}
function id(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
function snap(value: number) {
  return Math.round(value / GRID) * GRID;
}
function snapRotation(value: number) {
  return Math.round(value / 15) * 15;
}
function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}
