export type TokenEntry = {
  readonly name: string;
  readonly cssVariable: `--hds-${string}`;
  readonly value: string;
  readonly purpose: string;
  readonly internal?: boolean;
};

const token = (name: string, value: string, purpose: string, internal = false): TokenEntry => ({
  name,
  cssVariable: `--hds-${name}`,
  value,
  purpose,
  ...(internal ? { internal } : {}),
});

export const rawNeutralTokens = [
  token('color-slate-25', '#FCFCFD', 'Neutral canvas'),
  token('color-slate-50', '#F8FAFC', 'Subtle surface'),
  token('color-slate-100', '#F1F5F9', 'Inset surface'),
  token('color-slate-200', '#E2E8F0', 'Default border'),
  token('color-slate-300', '#CBD5E1', 'Strong border'),
  token('color-slate-400', '#94A3B8', 'Placeholder'),
  token('color-slate-500', '#64748B', 'Tertiary text'),
  token('color-slate-600', '#475569', 'Secondary text'),
  token('color-slate-700', '#334155', 'Strong secondary text'),
  token('color-slate-800', '#1E293B', 'Heading support'),
  token('color-slate-900', '#0F172A', 'Primary text'),
  token('color-slate-950', '#020617', 'Maximum emphasis'),
] as const;

export const rawOrangeTokens = [
  token('color-orange-50', '#FFF7F3', 'Accent tint'),
  token('color-orange-100', '#FFECE3', 'Accent subtle'),
  token('color-orange-200', '#FFD5C4', 'Accent border'),
  token('color-orange-300', '#FFB293', 'Accent muted'),
  token('color-orange-400', '#FF8155', 'Accent highlight'),
  token('color-orange-500', '#FF5A1F', 'Brand source color'),
  token('color-orange-600', '#E9470F', 'Brand strong'),
  token('color-orange-700', '#C7370B', 'Accessible primary action'),
  token('color-orange-800', '#9F2F0F', 'Primary action hover'),
  token('color-orange-900', '#812B12', 'Primary action pressed'),
  token('color-orange-950', '#461207', 'Maximum brand emphasis'),
] as const;

export const semanticColorTokens = [
  token('surface-canvas', 'var(--hds-color-slate-25)', 'Application canvas'),
  token('surface-default', '#FFFFFF', 'Default surface'),
  token('surface-raised', '#FFFFFF', 'Raised surface'),
  token('surface-subtle', 'var(--hds-color-slate-25)', 'Quiet grouping'),
  token('surface-inset', 'var(--hds-color-slate-100)', 'Inset control'),
  token('surface-selected', 'var(--hds-color-orange-50)', 'Selected/current item'),
  token('surface-disabled', 'var(--hds-color-slate-100)', 'Disabled surface'),
  token('surface-overlay', 'rgba(2, 6, 23, 0.48)', 'Overlay scrim'),
  token('text-primary', 'var(--hds-color-slate-900)', 'Primary content'),
  token('text-secondary', 'var(--hds-color-slate-600)', 'Secondary content'),
  token('text-tertiary', 'var(--hds-color-slate-500)', 'Supporting metadata'),
  token('text-inverse', '#FFFFFF', 'Text on strong backgrounds'),
  token('text-disabled', 'var(--hds-color-slate-400)', 'Disabled text'),
  token('text-link', '#D63F07', 'Accessible bright orange link'),
  token('border-subtle', 'var(--hds-color-slate-100)', 'Quiet separation'),
  token('border-default', 'var(--hds-color-slate-200)', 'Control and surface border'),
  token('border-strong', 'var(--hds-color-slate-300)', 'Emphasized boundary'),
  token('border-active', '#D63F07', 'Active boundary'),
  token('brand-accent', 'var(--hds-color-orange-500)', 'Bright brand accent'),
  token('action-primary', '#D63F07', 'Accessible bright primary action'),
  token('action-primary-hover', 'var(--hds-color-orange-700)', 'Primary hover'),
  token('action-primary-pressed', 'var(--hds-color-orange-800)', 'Primary pressed'),
  token('action-secondary', '#FFFFFF', 'Secondary action'),
  token('action-ghost-hover', 'var(--hds-color-slate-100)', 'Ghost hover'),
] as const;

export const stateTokens = [
  token('state-neutral-fg', 'var(--hds-color-slate-700)', 'Neutral status'),
  token('state-neutral-bg', 'var(--hds-color-slate-100)', 'Neutral status tint'),
  token('state-info-fg', '#175CD3', 'Information status'),
  token('state-info-accent', '#2F6FED', 'Bright information accent'),
  token('state-info-bg', '#EEF4FF', 'Information status tint'),
  token('state-info-border', '#AFCBFF', 'Information status border'),
  token('state-success-fg', '#067647', 'Successful status'),
  token('state-success-accent', '#16A34A', 'Bright success accent'),
  token('state-success-bg', '#F0FDF4', 'Successful status tint'),
  token('state-success-border', '#9FE3B5', 'Successful status border'),
  token('state-warning-fg', '#B54708', 'Warning status'),
  token('state-warning-accent', '#F59E0B', 'Bright warning accent'),
  token('state-warning-bg', '#FFF7E6', 'Warning status tint'),
  token('state-warning-border', '#FFD47A', 'Warning status border'),
  token('state-danger-fg', '#B42318', 'Danger status'),
  token('state-danger-accent', '#F04438', 'Bright danger accent'),
  token('state-danger-bg', '#FFF1F0', 'Danger status tint'),
  token('state-danger-border', '#FFB9B3', 'Danger status border'),
  token('state-hosted-fg', '#067647', 'Hosted source'),
  token('state-hosted-bg', '#ECFDF3', 'Hosted source tint'),
  token('state-external-fg', '#175CD3', 'External source'),
  token('state-external-bg', '#EFF8FF', 'External source tint'),
  token('4m-man', '#2F6FED', 'Man category'),
  token('4m-machine', '#16A34A', 'Machine category'),
  token('4m-material', '#D97706', 'Material category'),
  token('4m-method', '#DC2626', 'Method category'),
] as const;

export const typographyTokens = [
  token('font-sans', '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif', 'UI family'),
  ...[
    ['type-11-size', '0.6875rem', 'Utility text size'],
    ['type-11-line', '1rem', 'Utility text line height'],
    ['type-12-size', '0.75rem', 'Caption size'],
    ['type-12-line', '1.125rem', 'Caption line height'],
    ['type-13-size', '0.8125rem', 'Default UI size'],
    ['type-13-line', '1.25rem', 'Default UI line height'],
    ['type-14-size', '0.875rem', 'Body size'],
    ['type-14-line', '1.3125rem', 'Body line height'],
    ['type-16-size', '1rem', 'Lead size'],
    ['type-16-line', '1.5rem', 'Lead line height'],
    ['type-18-size', '1.125rem', 'Section heading'],
    ['type-18-line', '1.625rem', 'Section heading line'],
    ['type-20-size', '1.25rem', 'Page heading small'],
    ['type-20-line', '1.75rem', 'Page heading small line'],
    ['type-24-size', '1.5rem', 'Page heading'],
    ['type-24-line', '2rem', 'Page heading line'],
    ['type-30-size', '1.875rem', 'Display heading'],
    ['type-30-line', '2.375rem', 'Display heading line'],
    ['weight-regular', '400', 'Regular text'],
    ['weight-medium', '500', 'Control emphasis'],
    ['weight-semibold', '600', 'Heading emphasis'],
    ['weight-bold', '700', 'Metric emphasis'],
    ['tracking-default', '-0.006em', 'Default tracking'],
    ['measure-reading', '68ch', 'Readable paragraph width'],
  ].map(([name, value, purpose]) => token(name!, value!, purpose!)),
] as const;

export const spacingTokens = [
  ...Array.from({ length: 13 }, (_, index) =>
    token(`space-${index}`, `${index * 0.25}rem`, `${index * 4}px spacing step`),
  ),
  token('control-sm', '2rem', 'Small control height'),
  token('control-md', '2.25rem', 'Default control height'),
  token('control-lg', '2.5rem', 'Large control height'),
  token('control-xl', '2.75rem', 'Extra-large control height'),
  token('container', '90rem', 'Documentation content maximum'),
  token('sidebar-width', '15rem', 'Application sidebar width'),
] as const;

export const shapeTokens = [
  token('radius-xs', '0.25rem', 'Small control'),
  token('radius-sm', '0.375rem', 'Default control'),
  token('radius-md', '0.5rem', 'Card and panel'),
  token('radius-lg', '0.625rem', 'Overlay'),
  token('radius-xl', '0.75rem', 'Large surface'),
  token('radius-full', '9999px', 'Badge/avatar only'),
] as const;

export const elevationTokens = [
  token('shadow-flat', 'none', 'Flat surface'),
  token('shadow-card', '0 1px 2px rgba(2, 6, 23, 0.05)', 'Card'),
  token('shadow-sticky', '0 1px 3px rgba(2, 6, 23, 0.08)', 'Sticky navigation'),
  token('shadow-popover', '0 8px 24px rgba(2, 6, 23, 0.12)', 'Popover'),
  token('shadow-modal', '0 16px 40px rgba(2, 6, 23, 0.16)', 'Modal'),
  token('shadow-toast', '0 10px 30px rgba(2, 6, 23, 0.14)', 'Toast'),
] as const;

export const motionTokens = [
  token('duration-instant', '0ms', 'Immediate state'),
  token('duration-fast', '80ms', 'Hover and press'),
  token('duration-standard', '140ms', 'Control state'),
  token('duration-overlay', '200ms', 'Overlay'),
  token('duration-slow', '280ms', 'Large disclosure'),
  token('ease-standard', 'cubic-bezier(0.2, 0, 0, 1)', 'Common state change'),
  token('ease-enter', 'cubic-bezier(0, 0, 0, 1)', 'Entering element'),
  token('ease-exit', 'cubic-bezier(0.3, 0, 1, 1)', 'Exiting element'),
  token('ease-emphasized', 'cubic-bezier(0.2, 0.8, 0.2, 1)', 'Emphasized state'),
  token('press-y', '1px', 'Pressed control'),
  token('hover-y', '-1px', 'Interactive surface hover'),
  token('overlay-y', '4px', 'Overlay entry'),
  token('disclosure-rotate', '180deg', 'Disclosure state'),
  token('spin-turn', '1turn', 'Loading rotation'),
  token('disabled-opacity', '0.52', 'Disabled content'),
  token('scrim-opacity', '0.48', 'Overlay scrim'),
  token('stagger-short', '24ms', 'Short sequence'),
  token('stagger-medium', '40ms', 'Medium sequence'),
  token('spin-duration', '800ms', 'Spinner loop'),
  token('shimmer-duration', '1400ms', 'Skeleton loop'),
] as const;

export const densityTokens = [
  token('density-compact-row', '2.75rem', 'Compact table row'),
  token('density-comfortable-row', '3.25rem', 'Comfortable table row'),
  token('density-roomy-row', '3.75rem', 'Roomy table row'),
  token('density-compact-pad', '0.5rem', 'Compact padding'),
  token('density-comfortable-pad', '0.75rem', 'Comfortable padding'),
  token('density-roomy-pad', '1rem', 'Roomy padding'),
] as const;

export const layerTokens = [
  token('layer-base', '0', 'Document content'),
  token('layer-sticky', '20', 'Sticky navigation'),
  token('layer-dropdown', '40', 'Dropdown and popover'),
  token('layer-overlay', '50', 'Overlay scrim'),
  token('layer-modal', '60', 'Modal surface'),
  token('layer-toast', '70', 'Toast'),
  token('layer-tooltip', '80', 'Tooltip'),
] as const;

export const breakpointTokens = [
  token('breakpoint-sm', '640px', 'Small documentation viewport'),
  token('breakpoint-md', '768px', 'Tablet documentation viewport'),
  token('breakpoint-lg', '1024px', 'Large documentation viewport'),
  token('breakpoint-xl', '1280px', 'Product minimum viewport'),
  token('breakpoint-2xl', '1536px', 'Wide product viewport'),
] as const;

export const focusTokens = [
  token('focus-color', 'var(--hds-state-info-fg)', 'Focus indicator'),
  token('focus-width', '2px', 'Focus ring width'),
  token('focus-offset', '2px', 'Surface separation'),
] as const;

export const chartTokens = [
  token('chart-1', 'var(--hds-brand-accent)', 'Primary series'),
  token('chart-2', 'var(--hds-state-info-accent)', 'Secondary series'),
  token('chart-3', 'var(--hds-state-success-accent)', 'Positive series'),
  token('chart-4', 'var(--hds-state-warning-accent)', 'Warning series'),
  token('chart-5', 'var(--hds-state-danger-accent)', 'Critical series'),
] as const;

export const componentTokens = [
  token('component-tooltip-delay', '200ms', 'Tooltip reveal delay'),
  token('component-overlay-offset', '4px', 'Menu and tooltip offset'),
  token('component-popover-offset', '8px', 'Popover offset'),
  token('component-chart-height', '220px', 'Default chart plot height'),
  token('component-chart-axis-size', '11px', 'Chart axis label size'),
  token('component-chart-stroke', '2px', 'Chart line stroke'),
  token('component-chart-bar-radius', '4px', 'Chart bar top radius'),
] as const;

export const componentMetrics = {
  tooltipDelay: 200,
  overlayOffset: 4,
  popoverOffset: 8,
  chartHeight: 220,
  chartMargin: { top: 8, right: 12, left: -16, bottom: 0 },
  chartAxisSize: 11,
  chartStroke: 2,
  chartBarRadius: 4,
} as const;

export const tokenFamilies = {
  'Raw neutral': rawNeutralTokens,
  'Raw orange': rawOrangeTokens,
  Semantic: semanticColorTokens,
  States: stateTokens,
  Typography: typographyTokens,
  Spacing: spacingTokens,
  Shape: shapeTokens,
  Elevation: elevationTokens,
  Motion: motionTokens,
  Density: densityTokens,
  Layers: layerTokens,
  Breakpoints: breakpointTokens,
  Focus: focusTokens,
  Chart: chartTokens,
  Component: componentTokens,
} as const;

export type TokenFamilyName = keyof typeof tokenFamilies;
