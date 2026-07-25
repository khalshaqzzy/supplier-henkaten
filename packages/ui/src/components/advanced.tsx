import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Ellipsis,
  LogOut,
  Menu,
  Search,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  Children,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Accordion as RadixAccordion,
  Dialog as RadixDialog,
  DropdownMenu as RadixMenu,
  Popover as RadixPopover,
  Select as RadixSelect,
  Tabs as RadixTabs,
  Tooltip as RadixTooltip,
} from 'radix-ui';
import { cn } from '../lib/utils';
import { componentMetrics } from '../tokens';
import { Button, IconButton, Input, NativeSelect } from './primitives';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  label,
  placeholder = 'Pilih',
  disabled,
}: SelectProps) {
  return (
    <RadixSelect.Root
      {...(value !== undefined ? { value } : {})}
      {...(defaultValue !== undefined ? { defaultValue } : {})}
      {...(onValueChange ? { onValueChange } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <RadixSelect.Trigger className="hds-select" aria-label={label}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="hds-select__content" position="popper">
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                className="hds-select__item"
              >
                <RadixSelect.ItemIndicator>
                  <Check />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export interface ComboboxProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

export function Combobox({
  value,
  defaultValue,
  onValueChange,
  options,
  label,
  placeholder = 'Cari dan pilih',
  disabled,
}: ComboboxProps) {
  const listId = useId();
  return (
    <div className="hds-combobox">
      <Search aria-hidden="true" />
      <input
        className="hds-combobox__input"
        aria-label={label}
        list={listId}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </datalist>
    </div>
  );
}

export function DatePicker({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="hds-date-picker">
      <CalendarDays aria-hidden="true" />
      <Input type="date" aria-label={label} {...props} />
    </div>
  );
}

export interface DateRangeProps {
  startValue?: string;
  endValue?: string;
  onStartChange?: (value: string) => void;
  onEndChange?: (value: string) => void;
  disabled?: boolean;
  label: string;
}

export function DateRange({
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  disabled,
  label,
}: DateRangeProps) {
  return (
    <fieldset className="hds-date-range">
      <legend className="hds-sr-only">{label}</legend>
      <DatePicker
        label={`${label} mulai`}
        value={startValue}
        onChange={(event) => onStartChange?.(event.currentTarget.value)}
        disabled={disabled}
      />
      <span aria-hidden="true">–</span>
      <DatePicker
        label={`${label} selesai`}
        value={endValue}
        onChange={(event) => onEndChange?.(event.currentTarget.value)}
        disabled={disabled}
      />
    </fieldset>
  );
}

export function Tooltip({ label, children }: { label: ReactNode; children: ReactElement }) {
  return (
    <RadixTooltip.Provider delayDuration={componentMetrics.tooltipDelay}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className="hds-tooltip" sideOffset={componentMetrics.overlayOffset}>
            {label}
            <RadixTooltip.Arrow className="hds-tooltip__arrow" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: LucideIcon;
}

export interface DropdownMenuProps {
  trigger: ReactElement;
  items: readonly MenuItem[];
  label: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({
  trigger,
  items,
  label,
  open,
  defaultOpen,
  onOpenChange,
}: DropdownMenuProps) {
  return (
    <RadixMenu.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixMenu.Trigger asChild aria-label={label}>
        {trigger}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          className="hds-menu"
          sideOffset={componentMetrics.overlayOffset}
          align="end"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <RadixMenu.Item
                key={item.label}
                className={cn('hds-menu__item', item.destructive && 'is-danger')}
                {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
                {...(item.onSelect ? { onSelect: item.onSelect } : {})}
              >
                {Icon && <Icon aria-hidden="true" />}
                {item.label}
              </RadixMenu.Item>
            );
          })}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export interface PopoverProps {
  trigger: ReactElement;
  title?: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({
  trigger,
  title,
  children,
  open,
  defaultOpen,
  onOpenChange,
}: PopoverProps) {
  return (
    <RadixPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          className="hds-popover"
          sideOffset={componentMetrics.popoverOffset}
          align="start"
        >
          {title && <strong className="hds-popover__title">{title}</strong>}
          {children}
          <RadixPopover.Arrow className="hds-popover__arrow" />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export interface DialogProps {
  trigger: ReactElement;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: 'sm' | 'md' | 'lg';
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  footer,
  open,
  defaultOpen,
  onOpenChange,
  size = 'md',
}: DialogProps) {
  return (
    <RadixDialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="hds-dialog__overlay" />
        <RadixDialog.Content className={cn('hds-dialog', `hds-dialog--${size}`)}>
          <div className="hds-dialog__header">
            <div>
              <RadixDialog.Title>{title}</RadixDialog.Title>
              {description && <RadixDialog.Description>{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Tutup dialog" size="sm">
                <X />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {children && <div className="hds-dialog__body">{children}</div>}
          {footer && <div className="hds-dialog__footer">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface AlertDialogProps {
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  destructive?: boolean;
}

export function AlertDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Batal',
  onConfirm,
  destructive,
}: AlertDialogProps) {
  return (
    <Dialog
      trigger={trigger}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <RadixDialog.Close asChild>
            <Button>{cancelLabel}</Button>
          </RadixDialog.Close>
          <RadixDialog.Close asChild>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              {...(onConfirm ? { onClick: onConfirm } : {})}
            >
              {confirmLabel}
            </Button>
          </RadixDialog.Close>
        </>
      }
    />
  );
}

export interface SheetProps extends DialogProps {
  side?: 'left' | 'right';
}

export function Sheet({ side = 'right', ...props }: SheetProps) {
  const { trigger, title, description, children, footer, open, defaultOpen, onOpenChange } = props;
  return (
    <RadixDialog.Root
      {...(open !== undefined ? { open } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="hds-dialog__overlay" />
        <RadixDialog.Content className={cn('hds-sheet', `hds-sheet--${side}`)}>
          <div className="hds-dialog__header">
            <div>
              <RadixDialog.Title>{title}</RadixDialog.Title>
              {description && <RadixDialog.Description>{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Tutup panel" size="sm">
                <X />
              </IconButton>
            </RadixDialog.Close>
          </div>
          {children && <div className="hds-dialog__body">{children}</div>}
          {footer && <div className="hds-dialog__footer">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const Drawer = Sheet;

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  items: readonly TabItem[];
  label: string;
}

export function Tabs({ value, defaultValue, onValueChange, items, label }: TabsProps) {
  return (
    <RadixTabs.Root
      className="hds-tabs"
      {...(value !== undefined ? { value } : {})}
      {...(value === undefined && (defaultValue ?? items[0]?.value) !== undefined
        ? { defaultValue: defaultValue ?? items[0]!.value }
        : {})}
      {...(onValueChange ? { onValueChange } : {})}
    >
      <RadixTabs.List className="hds-tabs__list" aria-label={label}>
        {items.map((item) => (
          <RadixTabs.Trigger
            className="hds-tabs__trigger"
            key={item.value}
            value={item.value}
            {...(item.disabled !== undefined ? { disabled: item.disabled } : {})}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content className="hds-tabs__content" key={item.value} value={item.value}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

export function Accordion({
  items,
  type = 'multiple',
}: {
  items: readonly { value: string; title: ReactNode; content: ReactNode; disabled?: boolean }[];
  type?: 'single' | 'multiple';
}) {
  if (type === 'single') {
    return (
      <RadixAccordion.Root className="hds-accordion" type="single" collapsible>
        {items.map((item) => (
          <AccordionItem key={item.value} {...item} />
        ))}
      </RadixAccordion.Root>
    );
  }
  return (
    <RadixAccordion.Root className="hds-accordion" type="multiple">
      {items.map((item) => (
        <AccordionItem key={item.value} {...item} />
      ))}
    </RadixAccordion.Root>
  );
}

function AccordionItem({
  value,
  title,
  content,
  disabled,
}: {
  value: string;
  title: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}) {
  return (
    <RadixAccordion.Item
      className="hds-accordion__item"
      value={value}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <RadixAccordion.Header>
        <RadixAccordion.Trigger className="hds-accordion__trigger">
          {title}
          <ChevronDown aria-hidden="true" />
        </RadixAccordion.Trigger>
      </RadixAccordion.Header>
      <RadixAccordion.Content className="hds-accordion__content">{content}</RadixAccordion.Content>
    </RadixAccordion.Item>
  );
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="hds-breadcrumbs">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>}
            {index < items.length - 1 && <ChevronRight aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export interface SidebarItem {
  label: string;
  href: string;
  icon: LucideIcon;
  current?: boolean;
  count?: number;
}

export function BrandLockup({ context = 'Supplier Portal' }: { context?: string }) {
  return (
    <div className="hds-brand">
      <span className="hds-brand__mark" aria-hidden="true">
        <Menu />
      </span>
      <span>
        <strong>TMMIN Henkaten</strong>
        <small>{context}</small>
      </span>
    </div>
  );
}

export function Sidebar({
  context,
  items,
  footer,
}: {
  context: string;
  items: readonly SidebarItem[];
  footer?: ReactNode;
}) {
  return (
    <aside className="hds-sidebar">
      <BrandLockup context={context} />
      <nav className="hds-sidebar__nav" aria-label="Navigasi utama">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={`${item.href}:${item.label}`}
              href={item.href}
              className={cn('hds-sidebar__item', item.current && 'is-current')}
              aria-current={item.current ? 'page' : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
              {item.count !== undefined && <span className="hds-sidebar__count">{item.count}</span>}
            </a>
          );
        })}
      </nav>
      <div className="hds-sidebar__footer">{footer}</div>
    </aside>
  );
}

export function WorkspaceSwitcher({ name, context }: { name: string; context: string }) {
  return (
    <Button className="hds-workspace" trailingIcon={<ChevronDown />} aria-label="Ganti workspace">
      <span className="hds-workspace__text">
        <strong>{name}</strong>
        <small>{context}</small>
      </span>
    </Button>
  );
}

export function AccountMenu({ name, role }: { name: string; role: string }) {
  return (
    <DropdownMenu
      label="Menu akun"
      trigger={
        <button type="button" className="hds-account">
          <span className="hds-avatar hds-avatar--sm" aria-hidden="true">
            {name
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)}
          </span>
          <span>
            <strong>{name}</strong>
            <small>{role}</small>
          </span>
          <ChevronDown aria-hidden="true" />
        </button>
      }
      items={[
        { label: 'Akun saya', icon: UserRound },
        { label: 'Bantuan', icon: CircleHelp },
        { label: 'Keluar', icon: LogOut },
      ]}
    />
  );
}

export function Topbar({
  workspace,
  context,
  userName,
  role,
}: {
  workspace: string;
  context: string;
  userName: string;
  role: string;
}) {
  return (
    <header className="hds-topbar">
      <WorkspaceSwitcher name={workspace} context={context} />
      <div className="hds-topbar__search">
        <Search aria-hidden="true" />
        <span>Cari member, line, job, atau henkaten…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="hds-topbar__actions">
        <span className="hds-live">
          <span aria-hidden="true" />
          Live
        </span>
        <IconButton label="Notifikasi">
          <Bell />
        </IconButton>
        <AccountMenu name={userName} role={role} />
      </div>
    </header>
  );
}

export function AppShell({
  sidebar,
  topbar,
  children,
  className,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('hds-app-shell', className)}>
      {sidebar}
      <div className="hds-app-shell__main">
        {topbar}
        <main className="hds-app-shell__content">{children}</main>
      </div>
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="hds-panel-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="hds-panel-header__actions">{actions}</div>}
    </div>
  );
}

export function MoreButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <IconButton label="Tindakan lainnya" size="sm" {...props}>
      <Ellipsis />
    </IconButton>
  );
}

export function CompactNativeSelect({ children, ...props }: Parameters<typeof NativeSelect>[0]) {
  return <NativeSelect {...props}>{Children.toArray(children)}</NativeSelect>;
}
