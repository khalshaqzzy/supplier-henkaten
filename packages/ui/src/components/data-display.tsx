import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';
import { cn } from '../lib/utils';
import { componentMetrics } from '../tokens';
import { type Tone } from './primitives';

export function Card({
  className,
  interactive,
  selected,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <div
      className={cn(
        'hds-card',
        interactive && 'is-interactive',
        selected && 'is-selected',
        className,
      )}
      {...props}
    />
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('hds-panel', className)}>
      {(title || description || action) && (
        <header className="hds-panel__header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="hds-panel__body">{children}</div>
    </section>
  );
}

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn('hds-divider', className)} {...props} />;
}

export function Avatar({
  name,
  src,
  size = 'md',
  status,
}: {
  name: string;
  src?: string;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'offline';
}) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
  return (
    <span className={cn('hds-avatar-wrap', `hds-avatar-wrap--${size}`)}>
      {src ? <img src={src} alt="" /> : <span>{initials}</span>}
      {status && (
        <i className={`is-${status}`} aria-label={status === 'online' ? 'Online' : 'Offline'} />
      )}
    </span>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
}

export function KeyValueGrid({
  items,
  columns = 2,
}: {
  items: readonly KeyValueItem[];
  columns?: 1 | 2 | 3 | 4;
}) {
  return (
    <dl className={cn('hds-key-value', `hds-key-value--${columns}`)}>
      {items.map((item, index) => (
        <div key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatCard({
  label,
  value,
  detail,
  trend,
  trendDirection,
  icon,
  action,
  tone = 'brand',
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  trend?: ReactNode;
  trendDirection?: 'up' | 'down' | 'neutral';
  icon?: ReactNode;
  action?: ReactNode;
  tone?: Tone | 'brand';
}) {
  const TrendIcon =
    trendDirection === 'up' ? TrendingUp : trendDirection === 'down' ? TrendingDown : Minus;
  return (
    <Card className={cn('hds-stat', `hds-stat--${tone}`)}>
      <div className="hds-stat__top">
        <div>
          <span className="hds-stat__label">{label}</span>
          <strong className="hds-stat__value">{value}</strong>
        </div>
        {icon && <span className="hds-stat__icon">{icon}</span>}
      </div>
      {(trend || detail) && (
        <div className={cn('hds-stat__detail', trendDirection && `is-${trendDirection}`)}>
          {trend && <TrendIcon aria-hidden="true" />}
          <span>{trend ?? detail}</span>
        </div>
      )}
      {action && <div className="hds-stat__action">{action}</div>}
    </Card>
  );
}

export interface DataTableProps<TData extends object> {
  data: readonly TData[];
  columns: readonly ColumnDef<TData, unknown>[];
  caption: string;
  density?: 'compact' | 'comfortable' | 'roomy';
  emptyMessage?: string;
  getRowId?: (row: TData, index: number) => string;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
}

export function DataTable<TData extends object>({
  data,
  columns,
  caption,
  density = 'compact',
  emptyMessage = 'Tidak ada data yang cocok.',
  getRowId,
  sorting: controlledSorting,
  onSortingChange,
  manualSorting = false,
}: DataTableProps<TData>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const sorting = controlledSorting ?? localSorting;
  const table = useReactTable({
    data: [...data],
    columns: [...columns],
    state: { sorting },
    onSortingChange: onSortingChange ?? setLocalSorting,
    getCoreRowModel: getCoreRowModel(),
    ...(!manualSorting ? { getSortedRowModel: getSortedRowModel() } : {}),
    manualSorting,
    ...(getRowId ? { getRowId } : {}),
  });

  return (
    <div className="hds-table-wrap">
      <table className={cn('hds-table', `hds-table--${density}`)}>
        <caption className="hds-sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} scope="col">
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="hds-table__sort"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? (
                        <ArrowUp />
                      ) : header.column.getIsSorted() === 'desc' ? (
                        <ArrowDown />
                      ) : null}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td className="hds-table__empty" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

type ChartContextValue = { kind: 'line' | 'bar' };
const ChartContext = createContext<ChartContextValue>({ kind: 'line' });

export interface ChartSeries {
  dataKey: string;
  label: string;
  color: `var(--hds-${string})`;
}

export function ChartFrame({
  title,
  description,
  data,
  series,
  xKey,
  kind = 'line',
}: {
  title: string;
  description?: string;
  data: readonly Record<string, string | number>[];
  series: readonly ChartSeries[];
  xKey: string;
  kind?: 'line' | 'bar';
}) {
  const Chart = kind === 'line' ? LineChart : BarChart;
  return (
    <ChartContext.Provider value={{ kind }}>
      <div className="hds-chart">
        <div className="hds-chart__header">
          {(title || description) && (
            <div>
              {title && <h3>{title}</h3>}
              {description && <p>{description}</p>}
            </div>
          )}
          <ChartLegend series={series} />
        </div>
        <div className="hds-chart__plot">
          <ResponsiveContainer width="100%" height="100%">
            <Chart data={[...data]} margin={componentMetrics.chartMargin}>
              <CartesianGrid stroke="var(--hds-border-subtle)" vertical={false} />
              <XAxis
                dataKey={xKey}
                tick={{
                  fill: 'var(--hds-text-tertiary)',
                  fontSize: componentMetrics.chartAxisSize,
                }}
                axisLine={{ stroke: 'var(--hds-border-default)' }}
                tickLine={false}
              />
              <YAxis
                tick={{
                  fill: 'var(--hds-text-tertiary)',
                  fontSize: componentMetrics.chartAxisSize,
                }}
                axisLine={false}
                tickLine={false}
              />
              <RechartsTooltip contentStyle={{ display: 'none' }} cursor={false} />
              {series.map((item) =>
                kind === 'line' ? (
                  <Line
                    key={item.dataKey}
                    type="monotone"
                    dataKey={item.dataKey}
                    stroke={item.color}
                    strokeWidth={componentMetrics.chartStroke}
                    dot={false}
                  />
                ) : (
                  <Bar
                    key={item.dataKey}
                    dataKey={item.dataKey}
                    fill={item.color}
                    radius={[
                      componentMetrics.chartBarRadius,
                      componentMetrics.chartBarRadius,
                      0,
                      0,
                    ]}
                  />
                ),
              )}
            </Chart>
          </ResponsiveContainer>
        </div>
      </div>
    </ChartContext.Provider>
  );
}

export function ChartLegend({ series }: { series: readonly ChartSeries[] }) {
  useContext(ChartContext);
  return (
    <div className="hds-chart-legend" aria-label="Legenda grafik">
      {series.map((item) => (
        <span key={item.dataKey}>
          <i style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export interface TimelineItem {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: Tone;
  current?: boolean;
}

export function Timeline({ items }: { items: readonly TimelineItem[] }) {
  return (
    <ol className="hds-timeline">
      {items.map((item, index) => (
        <li key={index} className={item.current ? 'is-current' : undefined}>
          <span className={cn('hds-timeline__marker', `hds-tone--${item.tone ?? 'neutral'}`)}>
            {item.tone === 'success' ? <Check /> : <Circle />}
          </span>
          <div>
            <strong>{item.title}</strong>
            {item.description && <p>{item.description}</p>}
          </div>
          {item.meta && <small>{item.meta}</small>}
        </li>
      ))}
    </ol>
  );
}

export interface Step {
  label: string;
  description?: string;
  state: 'complete' | 'current' | 'upcoming' | 'blocked';
}

export function Stepper({ steps, label }: { steps: readonly Step[]; label: string }) {
  return (
    <ol className="hds-stepper" aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={`is-${step.state}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span>
            {step.state === 'complete' ? <Check /> : step.state === 'blocked' ? '!' : index + 1}
          </span>
          <div>
            <strong>{step.label}</strong>
            {step.description && <small>{step.description}</small>}
          </div>
          {index < steps.length - 1 && <ChevronRight aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

export function ToastViewport() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: 'hds-toast',
          title: 'hds-toast__title',
          description: 'hds-toast__description',
          actionButton: 'hds-toast__action',
        },
      }}
    />
  );
}

export const toast = {
  success: (title: string, description?: string) => sonnerToast.success(title, { description }),
  error: (title: string, description?: string) => sonnerToast.error(title, { description }),
  info: (title: string, description?: string) => sonnerToast.info(title, { description }),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export function ActivityItem({
  tone,
  title,
  description,
  time,
}: {
  tone: Tone;
  title: string;
  description: string;
  time: string;
}) {
  const Icon = tone === 'success' ? CircleCheck : tone === 'warning' ? Clock3 : Circle;
  return (
    <div className="hds-activity">
      <span className={cn('hds-activity__icon', `hds-tone--${tone}`)}>
        <Icon />
      </span>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <time>{time}</time>
    </div>
  );
}
