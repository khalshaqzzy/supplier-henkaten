import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  forwardRef,
  useId,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  Checkbox as RadixCheckbox,
  RadioGroup as RadixRadio,
  Switch as RadixSwitch,
} from 'radix-ui';
import { cn } from '../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled,
    leadingIcon,
    trailingIcon,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('hds-button', `hds-button--${variant}`, `hds-button--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span className="hds-button__slot" aria-hidden={loading || undefined}>
        {leadingIcon}
      </span>
      <span className="hds-button__label">{children}</span>
      <span className="hds-button__slot" aria-hidden={loading || undefined}>
        {loading ? <LoaderCircle className="hds-spinner" /> : trailingIcon}
      </span>
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, variant = 'ghost', size = 'md', loading, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn('hds-icon-button', `hds-button--${variant}`, `hds-button--${size}`, className)}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle className="hds-spinner" /> : children}
    </button>
  );
});

export function ButtonGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cn('hds-button-group', className)} {...props} />;
}

export function Link({
  className,
  unavailable,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { unavailable?: boolean }) {
  return (
    <a
      className={cn('hds-link', unavailable && 'is-unavailable', className)}
      aria-disabled={unavailable || undefined}
      tabIndex={unavailable ? -1 : props.tabIndex}
      {...(unavailable ? { href: undefined } : props)}
    >
      {children}
    </a>
  );
}

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  helperText?: ReactNode;
  errorText?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  helperText,
  errorText,
  required,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn('hds-field', className)}>
      <label className="hds-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {(errorText || helperText) && (
        <div className={cn('hds-field__message', errorText && 'is-error')}>
          {errorText ? <AlertCircle aria-hidden="true" /> : null}
          <span>{errorText ?? helperText}</span>
        </div>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, error, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn('hds-input', className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('hds-input hds-textarea', className)} {...props} />;
});

export function SearchInput({
  label = 'Cari',
  className,
  ...props
}: InputProps & { label?: string }) {
  return (
    <div className={cn('hds-search', className)}>
      <Search aria-hidden="true" />
      <input className="hds-search__input" aria-label={label} type="search" {...props} />
    </div>
  );
}

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, children, ...props }, ref) {
    return (
      <span className={cn('hds-native-select', className)}>
        <select ref={ref} {...props}>
          {children}
        </select>
        <ChevronDown aria-hidden="true" />
      </span>
    );
  },
);

export interface CheckboxProps {
  checked?: boolean | 'indeterminate';
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
  id?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  description,
  id,
}: CheckboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <label className={cn('hds-choice', disabled && 'is-disabled')} htmlFor={controlId}>
      <RadixCheckbox.Root
        id={controlId}
        className="hds-checkbox"
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange ? { onCheckedChange } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
      >
        <RadixCheckbox.Indicator>
          {checked === 'indeterminate' ? '−' : <Check />}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span>
        <span className="hds-choice__label">{label}</span>
        {description && <span className="hds-choice__description">{description}</span>}
      </span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly RadioOption[];
  label: string;
  disabled?: boolean;
}

export function RadioGroup({
  value,
  defaultValue,
  onValueChange,
  options,
  label,
  disabled,
}: RadioGroupProps) {
  return (
    <RadixRadio.Root
      className="hds-radio-group"
      aria-label={label}
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      {options.map((option) => (
        <label className={cn('hds-choice', option.disabled && 'is-disabled')} key={option.value}>
          <RadixRadio.Item
            className="hds-radio"
            value={option.value}
            {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
          >
            <RadixRadio.Indicator className="hds-radio__dot" />
          </RadixRadio.Item>
          <span>
            <span className="hds-choice__label">{option.label}</span>
            {option.description && (
              <span className="hds-choice__description">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </RadixRadio.Root>
  );
}

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  description?: ReactNode;
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  label,
  description,
}: SwitchProps) {
  return (
    <label className={cn('hds-switch-row', disabled && 'is-disabled')}>
      <span>
        <span className="hds-choice__label">{label}</span>
        {description && <span className="hds-choice__description">{description}</span>}
      </span>
      <RadixSwitch.Root
        className="hds-switch"
        {...(checked !== undefined ? { checked } : {})}
        {...(defaultChecked !== undefined ? { defaultChecked } : {})}
        {...(onCheckedChange ? { onCheckedChange } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
      >
        <RadixSwitch.Thumb className="hds-switch__thumb" />
      </RadixSwitch.Root>
    </label>
  );
}

export interface SegmentedControlProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly { value: string; label: ReactNode; disabled?: boolean }[];
  label: string;
}

export function SegmentedControl({
  value,
  defaultValue,
  onValueChange,
  options,
  label,
}: SegmentedControlProps) {
  const [internal, setInternal] = useState(defaultValue ?? options[0]?.value ?? '');
  const current = value ?? internal;
  const setValue = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };
  return (
    <div className="hds-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={cn('hds-segmented__item', current === option.value && 'is-selected')}
          aria-pressed={current === option.value}
          disabled={option.disabled}
          onClick={() => setValue(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn('hds-badge', `hds-tone--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

const toneIcons = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  const Icon = toneIcons[tone];
  return (
    <span className={cn('hds-badge hds-status-badge', `hds-tone--${tone}`, className)} {...props}>
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = toneIcons[tone];
  return (
    <div className={cn('hds-alert', `hds-alert--${tone}`, className)} role="status">
      <Icon aria-hidden="true" />
      <div className="hds-alert__body">
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const normalized = Math.min(100, Math.max(0, value));
  return (
    <div className={cn('hds-progress', className)}>
      <div className="hds-progress__meta">
        <span>{label}</span>
        <span>{normalized}%</span>
      </div>
      <div
        className="hds-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={normalized}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="hds-progress__value" style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

export function Spinner({ label = 'Memuat' }: { label?: string }) {
  return (
    <span className="hds-loading" role="status">
      <LoaderCircle className="hds-spinner" aria-hidden="true" />
      <span className="hds-sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('hds-skeleton', className)} aria-hidden="true" {...props} />;
}

export function StatePanel({
  kind,
  title,
  description,
  action,
}: {
  kind: 'empty' | 'error' | 'forbidden' | 'stale';
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const Icon = kind === 'error' ? CircleAlert : kind === 'stale' ? TriangleAlert : Info;
  return (
    <div className={cn('hds-state-panel', `hds-state-panel--${kind}`)}>
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export const EmptyState = (props: Omit<Parameters<typeof StatePanel>[0], 'kind'>) => (
  <StatePanel kind="empty" {...props} />
);
export const ErrorState = (props: Omit<Parameters<typeof StatePanel>[0], 'kind'>) => (
  <StatePanel kind="error" {...props} />
);
export const ForbiddenState = (props: Omit<Parameters<typeof StatePanel>[0], 'kind'>) => (
  <StatePanel kind="forbidden" {...props} />
);
export const StaleState = (props: Omit<Parameters<typeof StatePanel>[0], 'kind'>) => (
  <StatePanel kind="stale" {...props} />
);

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({ page, pageCount, onPageChange, disabled }: PaginationProps) {
  return (
    <nav className="hds-pagination" aria-label="Paginasi">
      <IconButton
        label="Halaman sebelumnya"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft />
      </IconButton>
      <span>
        Halaman <strong>{page}</strong> dari {pageCount}
      </span>
      <IconButton
        label="Halaman berikutnya"
        size="sm"
        disabled={disabled || page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight />
      </IconButton>
    </nav>
  );
}

export function DismissButton({ label = 'Tutup', ...props }: IconButtonProps) {
  return (
    <IconButton label={label} {...props}>
      <X />
    </IconButton>
  );
}
