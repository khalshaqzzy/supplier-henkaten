import { Check, ChevronDown, Search, UserRound } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Popover } from './advanced';

export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
  disabledReason?: string;
}
export interface SearchSelectProps {
  label: string;
  value: string;
  options: readonly SearchSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearLabel?: string;
  hideLabel?: boolean;
}
const normalize = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('id');

/** Search text and the committed identity are deliberately separate. */
export function SearchSelect({
  label,
  value,
  options,
  onValueChange,
  placeholder = 'Pilih member',
  disabled = false,
  clearLabel = 'Tanpa assignment',
  hideLabel = false,
}: SearchSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
    return options.filter((option) =>
      terms.every((term) =>
        normalize(`${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`).includes(
          term,
        ),
      ),
    );
  }, [options, search]);
  const choices: readonly SearchSelectOption[] = search.trim()
    ? filtered
    : [{ value: '', label: clearLabel }, ...filtered];
  const enabled = choices
    .map((option, index) => (option.disabledReason ? -1 : index))
    .filter((index) => index >= 0);
  const activeIndex = enabled.includes(active) ? active : (enabled[0] ?? -1);
  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);
  const choose = (option: SearchSelectOption) => {
    if (option.disabledReason) return;
    onValueChange(option.value);
    setOpen(false);
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const current = enabled.indexOf(activeIndex);
      const next =
        (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActive(enabled[next] ?? -1);
    } else if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      setActive(enabled[0] ?? -1);
    } else if (event.key === 'End' && event.ctrlKey) {
      event.preventDefault();
      setActive(enabled.at(-1) ?? -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = choices[activeIndex];
      if (option) choose(option);
    }
  };
  return (
    <div className="hds-search-select">
      <span id={`${id}-label`} className={hideLabel ? 'sr-only' : 'hds-search-select__label'}>
        {label}
      </span>
      <Popover
        ariaLabel={`Pilih ${label}`}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setSearch('');
            setActive(Math.max(0, options.findIndex((option) => option.value === value) + 1));
          }
        }}
        trigger={
          <button
            type="button"
            className="hds-search-select__trigger"
            disabled={disabled}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSearch('');
                setOpen(true);
              }
            }}
          >
            <UserRound aria-hidden="true" />
            <span className="hds-search-select__identity">
              <span id={`${id}-value`} className={selected ? '' : 'is-placeholder'}>
                {selected?.label ?? placeholder}
              </span>
              {selected?.description && <small>{selected.description}</small>}
            </span>
            <ChevronDown aria-hidden="true" className={open ? 'is-open' : ''} />
          </button>
        }
      >
        <div className="hds-search-select__popup" aria-label={`Pilih ${label}`}>
          <div className="hds-search-select__search">
            <Search aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-label={`Cari ${label}`}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
              autoComplete="off"
              placeholder="Cari nama, registrasi, atau kode…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActive(0);
              }}
              onKeyDown={keyboard}
            />
          </div>
          <div className="hds-search-select__meta" role="status">
            {filtered.length} pilihan{search.trim() ? ` untuk “${search.trim()}”` : ''}
          </div>
          <div
            id={`${id}-list`}
            ref={list}
            role="listbox"
            aria-label={label}
            className="hds-search-select__list"
          >
            {choices.map((option, index) => (
              <button
                type="button"
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={Boolean(option.disabledReason)}
                tabIndex={-1}
                className={`hds-search-select__option${index === activeIndex ? ' is-active' : ''}`}
                onPointerMove={() => {
                  if (!option.disabledReason) setActive(index);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span
                  className={`hds-search-select__avatar${option.value ? '' : ' is-clear'}`}
                  aria-hidden="true"
                >
                  {option.value
                    ? option.label
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join('')
                    : '—'}
                </span>
                <span className="hds-search-select__identity">
                  <strong>{option.label}</strong>
                  {option.description && <small>{option.description}</small>}
                  {option.disabledReason && (
                    <small className="hds-search-select__unavailable">
                      {option.disabledReason}
                    </small>
                  )}
                </span>
                {option.value === value && (
                  <Check aria-hidden="true" className="hds-search-select__check" />
                )}
              </button>
            ))}
          </div>
          {choices.length === 0 && (
            <div className="hds-search-select__empty">
              <Search aria-hidden="true" />
              <strong>Member tidak ditemukan</strong>
              <span>Coba nama, nomor registrasi, atau kode lain.</span>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  input.current?.focus();
                }}
              >
                Bersihkan pencarian
              </button>
            </div>
          )}
        </div>
      </Popover>
    </div>
  );
}
