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
  Hand,
  Lock,
  Minimize2,
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

import {
  BOARD_JOB_CARD_DEFAULT_HEIGHT,
  BOARD_JOB_CARD_DEFAULT_WIDTH,
  type BoardLayoutDocument,
  type BoardLayoutNode,
  type BoardMachineAssetKey,
  type HenkatenCategory,
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
const CAMERA_PADDING = 24;
const MIN_MANUAL_SCALE = 0.25;
const MAX_SCALE = 2;
const MIN_VISIBLE_CANVAS = 64;

export type CanvasCamera = { scale: number; x: number; y: number };
export type CanvasViewport = { width: number; height: number };
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
  const shellRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const draftRef = useRef<BoardLayoutDocument | null>(null);
  const cameraRef = useRef<CanvasCamera>({ scale: 0.5, x: 16, y: 16 });
  const viewportRef = useRef<CanvasViewport>({
    width: Math.max(320, Math.min(900, window.innerWidth - 40)),
    height: Math.max(420, Math.min(720, window.innerHeight - 220)),
  });
  const normalCameraRef = useRef<CanvasCamera | null>(null);
  const fittedLineRef = useRef<string | null>(null);
  const [viewport, setViewport] = useState(viewportRef.current);
  const [draft, setDraft] = useState<BoardLayoutDocument | null>(null);
  const [savedDocument, setSavedDocument] = useState<BoardLayoutDocument | null>(null);
  const [past, setPast] = useState<BoardLayoutDocument[]>([]);
  const [future, setFuture] = useState<BoardLayoutDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [camera, setCameraState] = useState<CanvasCamera>(cameraRef.current);
  const [panMode, setPanMode] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);
  const [stageDragging, setStageDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [editorViewport, setEditorViewport] = useState(
    () =>
      window.matchMedia('(min-width: 900px) and (orientation: landscape), (min-width: 1280px)')
        .matches,
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

  const setCamera = useCallback((next: CanvasCamera | ((value: CanvasCamera) => CanvasCamera)) => {
    setCameraState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      cameraRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = {
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      };
      const previous = viewportRef.current;
      viewportRef.current = next;
      setViewport(next);
      const layoutDocument = draftRef.current;
      if (!layoutDocument) return;
      if (document.fullscreenElement === shellRef.current) {
        setCamera(fitCanvasCamera(layoutDocument, next));
      } else if (normalCameraRef.current) {
        setCamera(normalCameraRef.current);
        normalCameraRef.current = null;
      } else {
        setCamera((current) => resizeCanvasCamera(current, previous, next, layoutDocument));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [setCamera]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const updateFullscreen = () => {
      const nextFullscreen = document.fullscreenElement === shellRef.current;
      setIsFullscreen(nextFullscreen);
      requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container) return;
        const nextViewport = {
          width: Math.max(1, Math.floor(container.clientWidth)),
          height: Math.max(1, Math.floor(container.clientHeight)),
        };
        viewportRef.current = nextViewport;
        setViewport(nextViewport);
        if (nextFullscreen && draftRef.current) {
          setCamera(fitCanvasCamera(draftRef.current, nextViewport));
        } else if (normalCameraRef.current) {
          setCamera(normalCameraRef.current);
          normalCameraRef.current = null;
        }
      });
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, [setCamera]);

  useEffect(() => {
    const media = window.matchMedia(
      '(min-width: 900px) and (orientation: landscape), (min-width: 1280px)',
    );
    const update = () => setEditorViewport(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName));
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      event.preventDefault();
      setSpacePanning(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanning(false);
    };
    const reset = () => setSpacePanning(false);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const fitView = useCallback(
    (document: BoardLayoutDocument | null = draft) => {
      if (document) setCamera(fitCanvasCamera(document, viewportRef.current));
    },
    [draft, setCamera],
  );

  const zoomView = useCallback(
    (nextScale: number, anchor = { x: viewport.width / 2, y: viewport.height / 2 }) => {
      if (!draft) return;
      setCamera((current) => zoomCanvasCamera(current, nextScale, anchor, viewport, draft));
    },
    [draft, setCamera, viewport],
  );

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement === shellRef.current) {
      await document.exitFullscreen();
      return;
    }
    normalCameraRef.current = cameraRef.current;
    try {
      await shellRef.current?.requestFullscreen();
    } catch (error) {
      normalCameraRef.current = null;
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!layout.data || editing) return;
    setDraft(layout.data.document);
    setSavedDocument(layout.data.document);
    setPast([]);
    setFuture([]);
    setSaveConflict(false);
    if (fittedLineRef.current !== line.lineId) {
      fittedLineRef.current = line.lineId;
      setCamera(fitCanvasCamera(layout.data.document, viewportRef.current));
    }
  }, [editing, layout.data, line.lineId, setCamera]);

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
        y: 100 + Math.floor(index / 4) * 500,
        width: BOARD_JOB_CARD_DEFAULT_WIDTH,
        height: BOARD_JOB_CARD_DEFAULT_HEIGHT,
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
  const panning = panMode || spacePanning;

  return (
    <section
      ref={shellRef}
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
            onClick={() => zoomView(camera.scale - 0.1)}
          />
          <span>{Math.round(camera.scale * 100)}%</span>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Plus />}
            aria-label="Perbesar"
            onClick={() => zoomView(camera.scale + 0.1)}
          />
          <Button
            size="sm"
            variant={panMode ? 'secondary' : 'ghost'}
            leadingIcon={panMode ? <MousePointer2 /> : <Hand />}
            aria-pressed={panMode}
            onClick={() => setPanMode((value) => !value)}
          >
            {panMode ? 'Select mode' : 'Pan mode'}
          </Button>
          <Button size="sm" variant="ghost" leadingIcon={<Focus />} onClick={() => fitView()}>
            Auto-fit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={isFullscreen ? <Minimize2 /> : <Expand />}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? 'Keluar fullscreen' : 'Fullscreen'}
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
        <div
          className={`board-canvas-viewport${panning ? ' is-pan-mode' : ''}${stageDragging ? ' is-panning' : ''}`}
          data-camera-scale={camera.scale}
          data-camera-x={camera.x}
          data-camera-y={camera.y}
          data-pan-active={panning}
          aria-label="Viewport canvas. Tahan Space untuk pan sementara."
          role="group"
          tabIndex={0}
          ref={containerRef}
        >
          <Stage
            ref={stageRef}
            width={viewport.width}
            height={viewport.height}
            scaleX={camera.scale}
            scaleY={camera.scale}
            x={camera.x}
            y={camera.y}
            draggable={panning}
            onDragStart={(event) => {
              if (event.target === event.target.getStage()) setStageDragging(true);
            }}
            onDragEnd={(event) => {
              if (event.target !== event.target.getStage()) return;
              setStageDragging(false);
              setCamera(
                constrainCanvasCamera(
                  { ...cameraRef.current, x: event.target.x(), y: event.target.y() },
                  viewportRef.current,
                  draft,
                ),
              );
            }}
            onWheel={(event) => {
              event.evt.preventDefault();
              const pointer = event.target.getStage()?.getPointerPosition();
              if (!pointer) return;
              zoomView(cameraRef.current.scale * (event.evt.deltaY > 0 ? 0.9 : 1.1), pointer);
            }}
            onMouseDown={(event) => {
              containerRef.current?.focus({ preventScroll: true });
              if (!panning && event.target === event.target.getStage()) setSelectedId(null);
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
                    editing={editing && !panning}
                    selected={selectedId === node.id}
                    onSelect={() => {
                      if (!panning) setSelectedId(node.id);
                    }}
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
                  {...(selected.type === 'JOB_SLOT' && field === 'width' ? { min: 220 } : {})}
                  {...(selected.type === 'JOB_SLOT' && field === 'height' ? { min: 360 } : {})}
                  value={Math.round(selected.transform[field])}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (selected.type !== 'JOB_SLOT' || (field !== 'width' && field !== 'height')) {
                      onTransform({ ...selected.transform, [field]: value });
                      return;
                    }
                    const ratio = BOARD_JOB_CARD_DEFAULT_HEIGHT / BOARD_JOB_CARD_DEFAULT_WIDTH;
                    onTransform(
                      field === 'width'
                        ? {
                            ...selected.transform,
                            width: Math.max(220, value),
                            height: Math.max(360, Math.round(value * ratio)),
                          }
                        : {
                            ...selected.transform,
                            width: Math.max(220, Math.round(value / ratio)),
                            height: Math.max(360, value),
                          },
                    );
                  }}
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
        node.type === 'JOB_SLOT' ? 220 : 40,
        node.transform.width * target.scaleX(),
      );
      const height = Math.max(
        node.type === 'JOB_SLOT' ? 360 : 40,
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
          keepRatio={node.type === 'MACHINE_ASSET' || node.type === 'JOB_SLOT'}
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
  const photoWidth = Math.max(150, width - 88);
  const photoHeight = Math.max(176, height - 212);
  const photoX = (width - photoWidth) / 2;
  const photoY = 92;
  const identityY = photoY + photoHeight + 14;
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
      <Rect width={width} height={10} fill={accent} cornerRadius={[20, 20, 0, 0]} />
      <Text
        x={20}
        y={20}
        width={width - 40}
        height={28}
        align="center"
        text={job?.jobName ?? 'Job unavailable'}
        fontSize={22}
        fontStyle="bold"
        fill="#172033"
        wrap="none"
        ellipsis
      />
      <Rect
        x={(width - 116) / 2}
        y={54}
        width={116}
        height={28}
        fill={`${accent}18`}
        stroke={accent}
        strokeWidth={1.5}
        cornerRadius={15}
      />
      <Text
        x={(width - 108) / 2}
        y={61}
        width={108}
        align="center"
        text={`${state === 'ASSIGNED' ? '✓' : '!'} ${humanize(state)}`}
        fontSize={12}
        fontStyle="bold"
        fill={accent}
      />
      <Rect
        x={photoX}
        y={photoY}
        width={photoWidth}
        height={photoHeight}
        fill="#e9eef7"
        stroke="#d5ddeb"
        strokeWidth={2}
        cornerRadius={16}
      />
      {photo ? (
        <KonvaImage
          image={photo}
          x={photoX}
          y={photoY}
          width={photoWidth}
          height={photoHeight}
          crop={coverCrop(photo, photoWidth, photoHeight)}
          cornerRadius={16}
        />
      ) : (
        <Text
          x={photoX}
          y={photoY + photoHeight / 2 - 18}
          width={photoWidth}
          align="center"
          text={mpVisual.fallback}
          fontSize={36}
          fontStyle="bold"
          fill="#526176"
        />
      )}
      <Text
        x={20}
        y={identityY}
        width={width - 40}
        align="center"
        text={job?.mp.name ?? 'Vacant'}
        fontSize={19}
        fontStyle="bold"
        fill="#263246"
        wrap="none"
        ellipsis
      />
      <Text
        x={20}
        y={identityY + 28}
        width={width - 40}
        align="center"
        text={job?.mp.registrationNumber ?? humanize(state)}
        fontSize={14}
        fill="#667085"
      />
      {(job?.indicators ?? []).map((indicator, index) => (
        <Circle
          key={indicator.henkatenId}
          x={width / 2 + ((job?.indicators.length ?? 1) - 1) * 12 - index * 24}
          y={height - 18}
          radius={8}
          fill={categoryColors[indicator.category]}
          stroke={indicator.status === 'OPEN' ? '#172033' : '#ffffff'}
          strokeWidth={indicator.status === 'OPEN' ? 2 : 1}
        />
      ))}
    </Group>
  );
}

function coverCrop(image: HTMLImageElement, targetWidth: number, targetHeight: number) {
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  if (sourceRatio > targetRatio) {
    const width = image.naturalHeight * targetRatio;
    return { x: (image.naturalWidth - width) / 2, y: 0, width, height: image.naturalHeight };
  }
  const height = image.naturalWidth / targetRatio;
  return { x: 0, y: (image.naturalHeight - height) / 2, width: image.naturalWidth, height };
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

export function fitCanvasCamera(
  document: BoardLayoutDocument,
  viewport: CanvasViewport,
  padding = CAMERA_PADDING,
): CanvasCamera {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = Math.max(
    Number.EPSILON,
    Math.min(
      MAX_SCALE,
      availableWidth / document.canvas.width,
      availableHeight / document.canvas.height,
    ),
  );
  return {
    scale,
    x: (viewport.width - document.canvas.width * scale) / 2,
    y: (viewport.height - document.canvas.height * scale) / 2,
  };
}

export function resizeCanvasCamera(
  camera: CanvasCamera,
  previous: CanvasViewport,
  next: CanvasViewport,
  document: BoardLayoutDocument,
): CanvasCamera {
  if (previous.width <= 1 || previous.height <= 1) return fitCanvasCamera(document, next);
  const fitted = fitCanvasCamera(document, next);
  const wasFullyVisible =
    camera.x >= -0.5 &&
    camera.y >= -0.5 &&
    camera.x + document.canvas.width * camera.scale <= previous.width + 0.5 &&
    camera.y + document.canvas.height * camera.scale <= previous.height + 0.5;
  if (wasFullyVisible && fitted.scale < camera.scale) return fitted;
  const logicalCenter = {
    x: (previous.width / 2 - camera.x) / camera.scale,
    y: (previous.height / 2 - camera.y) / camera.scale,
  };
  return constrainCanvasCamera(
    {
      ...camera,
      x: next.width / 2 - logicalCenter.x * camera.scale,
      y: next.height / 2 - logicalCenter.y * camera.scale,
    },
    next,
    document,
  );
}

export function zoomCanvasCamera(
  camera: CanvasCamera,
  nextScale: number,
  anchor: { x: number; y: number },
  viewport: CanvasViewport,
  document: BoardLayoutDocument,
): CanvasCamera {
  const scale = Math.max(Math.min(MIN_MANUAL_SCALE, camera.scale), Math.min(MAX_SCALE, nextScale));
  const logicalAnchor = {
    x: (anchor.x - camera.x) / camera.scale,
    y: (anchor.y - camera.y) / camera.scale,
  };
  return constrainCanvasCamera(
    {
      scale,
      x: anchor.x - logicalAnchor.x * scale,
      y: anchor.y - logicalAnchor.y * scale,
    },
    viewport,
    document,
  );
}

export function constrainCanvasCamera(
  camera: CanvasCamera,
  viewport: CanvasViewport,
  document: BoardLayoutDocument,
): CanvasCamera {
  const scaledWidth = document.canvas.width * camera.scale;
  const scaledHeight = document.canvas.height * camera.scale;
  const constrainAxis = (position: number, viewportSize: number, contentSize: number) => {
    const minimum = MIN_VISIBLE_CANVAS - contentSize;
    const maximum = viewportSize - MIN_VISIBLE_CANVAS;
    return minimum > maximum
      ? (viewportSize - contentSize) / 2
      : Math.max(minimum, Math.min(maximum, position));
  };
  return {
    ...camera,
    x: constrainAxis(camera.x, viewport.width, scaledWidth),
    y: constrainAxis(camera.y, viewport.height, scaledHeight),
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
