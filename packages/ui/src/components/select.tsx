import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Popover as RadixPopover } from 'radix-ui';
import { cn } from '../lib/utils';
import { componentMetrics } from '../tokens';

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary line inside the list. It is never copied into the closed trigger. */
  description?: string | undefined;
  /** Short right-aligned value such as hours, counts or a code. */
  meta?: string | undefined;
  /** Extra search terms that are not displayed. */
  keywords?: string | undefined;
  disabled?: boolean | undefined;
  /** Short reason shown under a disabled option. Implies `disabled`. */
  disabledReason?: string | undefined;
  /** Options sharing a group name are rendered under one heading, in first-seen order. */
  group?: string | undefined;
  icon?: ReactNode | undefined;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string | undefined;
  defaultValue?: string | undefined;
  onValueChange?: ((value: string) => void) | undefined;
  /** Accessible name when the select is not named by a `<label>` or `Field`. */
  label?: string | undefined;
  placeholder?: string | undefined;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  size?: 'sm' | 'md' | undefined;
  /** `auto` shows a search field when there are more than `searchThreshold` options. */
  searchable?: boolean | 'auto' | undefined;
  searchThreshold?: number | undefined;
  searchPlaceholder?: string | undefined;
  emptyText?: string | undefined;
  leadingIcon?: ReactNode | undefined;
  align?: 'start' | 'end' | undefined;
  className?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  [dataAttribute: `data-${string}`]: string | boolean | undefined;
}

const normalize = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('id');

const isDisabled = (option: SelectOption) => Boolean(option.disabled || option.disabledReason);

/**
 * Single-value select following the WAI-ARIA select-only combobox pattern. The trigger keeps
 * focus semantics of a form control (`Field` and wrapping `<label>` name it), the list is
 * portalled above dialogs, and long lists gain an inline filter. Empty-string values are valid
 * options so "all" filters work without sentinels at call sites.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    options,
    value: controlledValue,
    defaultValue,
    onValueChange,
    label,
    placeholder = 'Pilih',
    id,
    name,
    disabled = false,
    required,
    invalid,
    size = 'md',
    searchable = 'auto',
    searchThreshold = 8,
    searchPlaceholder = 'Cari…',
    emptyText = 'Tidak ada pilihan yang cocok',
    leadingIcon,
    align = 'start',
    className,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const baseId = id ?? `hds-select-${generatedId.replace(/:/g, '')}`;
  const listId = `${baseId}-listbox`;
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');
  const value = controlledValue ?? uncontrolledValue;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const withSearch = searchable === 'auto' ? options.length > searchThreshold : searchable;
  const selected = options.find((option) => option.value === value);

  const visible = useMemo(() => {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return options;
    return options.filter((option) => {
      const haystack = normalize(
        `${option.label} ${option.description ?? ''} ${option.meta ?? ''} ${option.keywords ?? ''}`,
      );
      return terms.every((term) => haystack.includes(term));
    });
  }, [options, query]);

  const enabledIndexes = useMemo(
    () => visible.map((option, index) => (isDisabled(option) ? -1 : index)).filter((i) => i >= 0),
    [visible],
  );

  const commit = (option: SelectOption) => {
    if (isDisabled(option)) return;
    if (controlledValue === undefined) setUncontrolledValue(option.value);
    if (option.value !== value) onValueChange?.(option.value);
    setOpen(false);
  };

  const openList = useCallback(
    (seed?: string) => {
      if (disabled) return;
      setQuery(withSearch && seed ? seed : '');
      setOpen(true);
    },
    [disabled, withSearch],
  );

  // Highlight the committed value (or the first enabled option) whenever the list opens or filters.
  useEffect(() => {
    if (!open) return;
    const selectedIndex = visible.findIndex((option) => option.value === value);
    setActive(
      selectedIndex >= 0 && !isDisabled(visible[selectedIndex]!) && !query
        ? selectedIndex
        : (enabledIndexes[0] ?? -1),
    );
    // Re-anchor only when the list opens or the filter changes, not on every value render.
  }, [open, query]);

  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const move = (direction: 1 | -1 | 'first' | 'last' | 'pageDown' | 'pageUp') => {
    if (!enabledIndexes.length) return;
    const position = enabledIndexes.indexOf(active);
    let next: number;
    if (direction === 'first') next = 0;
    else if (direction === 'last') next = enabledIndexes.length - 1;
    else if (direction === 'pageDown') next = Math.min(enabledIndexes.length - 1, position + 8);
    else if (direction === 'pageUp') next = Math.max(0, position - 8);
    else if (position < 0) next = direction === 1 ? 0 : enabledIndexes.length - 1;
    else next = Math.min(enabledIndexes.length - 1, Math.max(0, position + direction));
    setActive(enabledIndexes[next] ?? -1);
  };

  const matchTypeahead = (char: string) => {
    const now = Date.now();
    const text = now - typeahead.current.at > 700 ? char : typeahead.current.text + char;
    typeahead.current = { text, at: now };
    const needle = normalize(text);
    const start = Math.max(0, active);
    const ordered = [...enabledIndexes.filter((i) => i > start), ...enabledIndexes];
    const found = ordered.find((i) => normalize(visible[i]!.label).startsWith(needle));
    if (found !== undefined) setActive(found);
    return found;
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey && key === 'ArrowUp') {
        const option = visible[active];
        if (option) commit(option);
        return;
      }
      move(key === 'ArrowDown' ? 1 : -1);
    } else if (key === 'Home' && (!withSearch || event.ctrlKey)) {
      event.preventDefault();
      move('first');
    } else if (key === 'End' && (!withSearch || event.ctrlKey)) {
      event.preventDefault();
      move('last');
    } else if (key === 'PageDown' || key === 'PageUp') {
      event.preventDefault();
      move(key === 'PageDown' ? 'pageDown' : 'pageUp');
    } else if (key === 'Enter' || (key === ' ' && !withSearch)) {
      event.preventDefault();
      const option = visible[active];
      if (option) commit(option);
    } else if (key === 'Tab') {
      setOpen(false);
    } else if (!withSearch && key.length === 1 && !event.ctrlKey && !event.metaKey) {
      matchTypeahead(key);
    }
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const key = event.key;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
      event.preventDefault();
      openList();
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      openList(key);
      if (!withSearch) requestAnimationFrame(() => matchTypeahead(key));
    }
  };

  const grouped = useMemo(() => {
    const sections: {
      group: string | undefined;
      items: { option: SelectOption; index: number }[];
    }[] = [];
    visible.forEach((option, index) => {
      const section = sections.find((entry) => entry.group === option.group);
      if (section) section.items.push({ option, index });
      else sections.push({ group: option.group, items: [{ option, index }] });
    });
    return sections;
  }, [visible]);

  const optionId = (index: number) => `${baseId}-option-${index}`;
  const activeDescendant = open && active >= 0 ? optionId(active) : undefined;
  const showPlaceholder = !selected;

  return (
    <RadixPopover.Root open={open} onOpenChange={(next) => (next ? openList() : setOpen(false))}>
      <RadixPopover.Trigger asChild>
        <button
          ref={ref}
          id={baseId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel ?? label}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          data-size={size}
          data-placeholder={showPlaceholder ? '' : undefined}
          className={cn('hds-select', className)}
          onKeyDown={onTriggerKeyDown}
          {...rest}
        >
          {leadingIcon && (
            <span className="hds-select__leading" aria-hidden="true">
              {leadingIcon}
            </span>
          )}
          {selected?.icon && (
            <span className="hds-select__leading" aria-hidden="true">
              {selected.icon}
            </span>
          )}
          <span className="hds-select__value">{selected?.label ?? placeholder}</span>
          {selected?.meta && <span className="hds-select__value-meta">{selected.meta}</span>}
          <ChevronDown aria-hidden="true" className="hds-select__chevron" />
        </button>
      </RadixPopover.Trigger>
      {name && <input type="hidden" name={name} value={value} />}
      <RadixPopover.Portal>
        <RadixPopover.Content
          className="hds-select__content"
          role="presentation"
          data-size={size}
          align={align}
          side="bottom"
          sideOffset={componentMetrics.overlayOffset}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (withSearch ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
          }}
        >
          {withSearch && (
            <div className="hds-select__search">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label={`Cari ${ariaLabel ?? label ?? 'pilihan'}`}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                autoComplete="off"
                spellCheck={false}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onListKeyDown}
              />
              {query && (
                <button
                  type="button"
                  className="hds-select__search-clear"
                  aria-label="Bersihkan pencarian"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={withSearch ? -1 : 0}
            aria-label={ariaLabel ?? label}
            aria-labelledby={ariaLabel || label ? undefined : (ariaLabelledBy ?? baseId)}
            aria-activedescendant={withSearch ? undefined : activeDescendant}
            className="hds-select__list"
            onKeyDown={withSearch ? undefined : onListKeyDown}
          >
            {grouped.map(({ group, items }) => {
              const rows = items.map(({ option, index }) => {
                const checked = option.value === value;
                const unavailable = isDisabled(option);
                return (
                  <div
                    key={`${option.value}-${index}`}
                    id={optionId(index)}
                    data-index={index}
                    data-value={option.value}
                    role="option"
                    aria-labelledby={`${optionId(index)}-label`}
                    aria-describedby={
                      [
                        option.description && `${optionId(index)}-description`,
                        option.disabledReason && `${optionId(index)}-reason`,
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    aria-selected={checked}
                    aria-disabled={unavailable || undefined}
                    className={cn(
                      'hds-select__option',
                      index === active && 'is-active',
                      checked && 'is-selected',
                      unavailable && 'is-disabled',
                    )}
                    onPointerMove={() => {
                      if (!unavailable && active !== index) setActive(index);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => commit(option)}
                  >
                    {option.icon && (
                      <span className="hds-select__option-icon" aria-hidden="true">
                        {option.icon}
                      </span>
                    )}
                    <span className="hds-select__option-copy">
                      <span id={`${optionId(index)}-label`} className="hds-select__option-label">
                        {option.label}
                      </span>
                      {option.description && (
                        <span
                          id={`${optionId(index)}-description`}
                          className="hds-select__option-description"
                        >
                          {option.description}
                        </span>
                      )}
                      {option.disabledReason && (
                        <span
                          id={`${optionId(index)}-reason`}
                          className="hds-select__option-reason"
                        >
                          {option.disabledReason}
                        </span>
                      )}
                    </span>
                    {option.meta && <span className="hds-select__option-meta">{option.meta}</span>}
                    <span className="hds-select__check" aria-hidden="true">
                      {checked && <Check />}
                    </span>
                  </div>
                );
              });
              if (!group) return rows;
              const groupId = `${baseId}-group-${normalize(group).replace(/\W+/g, '-')}`;
              return (
                <div key={group} role="group" aria-labelledby={groupId}>
                  <div id={groupId} role="presentation" className="hds-select__group-label">
                    {group}
                  </div>
                  {rows}
                </div>
              );
            })}
            {visible.length === 0 && (
              <div className="hds-select__empty" role="presentation">
                <Search aria-hidden="true" />
                <span>{emptyText}</span>
              </div>
            )}
          </div>
          {withSearch && (
            <div className="hds-select__footer" aria-live="polite">
              {query.trim()
                ? `${visible.length} dari ${options.length} pilihan`
                : `${options.length} pilihan`}
            </div>
          )}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
});
