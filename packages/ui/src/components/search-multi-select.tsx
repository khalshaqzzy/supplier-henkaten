import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Popover } from './advanced';
import type { SearchSelectOption } from './search-select';

export interface SearchMultiSelectOption extends SearchSelectOption {
  /** Secondary information shown on the selected row, for example other assignments. */
  note?: string;
}

export interface SearchMultiSelectProps {
  label: string;
  values: readonly string[];
  options: readonly SearchMultiSelectOption[];
  onValuesChange: (values: string[]) => void;
  /** Maximum number of selected values. */
  max?: number;
  addLabel?: string;
  emptyLabel?: string;
  disabled?: boolean;
}

const normalize = (text: string) =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id');

const initials = (label: string) =>
  label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

/**
 * Searchable selection of several identities. Selected entries stay visible as removable rows;
 * the popover toggles entries without closing so several can be chosen in one pass.
 */
export function SearchMultiSelect({
  label,
  values,
  options,
  onValuesChange,
  max,
  addLabel = `Tambah ${label}`,
  emptyLabel = `Belum ada ${label}`,
  disabled = false,
}: SearchMultiSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selected = values.flatMap((value) => {
    const option = options.find((item) => item.value === value);
    return option ? [option] : [];
  });
  const full = max !== undefined && values.length >= max;
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
  const unavailable = (option: SearchMultiSelectOption) =>
    selectedSet.has(option.value)
      ? undefined
      : (option.disabledReason ?? (full ? `Maksimal ${max} dipilih` : undefined));
  const enabled = filtered
    .map((option, index) => (unavailable(option) ? -1 : index))
    .filter((index) => index >= 0);
  const activeIndex = enabled.includes(active) ? active : (enabled[0] ?? -1);
  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const toggle = (option: SearchMultiSelectOption) => {
    if (unavailable(option)) return;
    onValuesChange(
      selectedSet.has(option.value)
        ? values.filter((value) => value !== option.value)
        : [...values, option.value],
    );
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!enabled.length) return;
      const current = enabled.indexOf(activeIndex);
      const next =
        (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActive(enabled[next] ?? -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) toggle(option);
    } else if (event.key === 'Backspace' && !search && values.length) {
      onValuesChange(values.slice(0, -1));
    }
  };

  return (
    <div className="hds-multi-select" role="group" aria-labelledby={`${id}-label`}>
      <div className="hds-multi-select__header">
        <span id={`${id}-label`} className="hds-search-select__label">
          {label}
        </span>
        {max !== undefined && (
          <span className="hds-multi-select__count" aria-live="polite">
            {values.length}/{max}
          </span>
        )}
      </div>
      {selected.length ? (
        <ul className="hds-multi-select__selected" aria-label={`${label} terpilih`}>
          {selected.map((option) => (
            <li key={option.value} className="hds-multi-select__item">
              <span className="hds-search-select__avatar" aria-hidden="true">
                {initials(option.label)}
              </span>
              <span className="hds-search-select__identity">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
                {option.note && <small className="hds-multi-select__note">{option.note}</small>}
                {option.disabledReason && (
                  <small className="hds-search-select__unavailable">{option.disabledReason}</small>
                )}
              </span>
              <button
                type="button"
                className="hds-multi-select__remove"
                aria-label={`Hapus ${option.label}`}
                disabled={disabled}
                onClick={() => onValuesChange(values.filter((value) => value !== option.value))}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="hds-multi-select__empty">{emptyLabel}</div>
      )}
      <Popover
        ariaLabel={`Pilih ${label}`}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setSearch('');
            setActive(0);
          }
        }}
        trigger={
          <button
            type="button"
            className="hds-multi-select__add"
            disabled={disabled || options.length === 0}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <Plus aria-hidden="true" />
            {addLabel}
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
            {values.length} dipilih{max !== undefined ? ` dari maksimal ${max}` : ''}
            {search.trim() ? ` · ${filtered.length} hasil` : ''}
          </div>
          <div
            id={`${id}-list`}
            ref={list}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            className="hds-search-select__list"
          >
            {filtered.map((option, index) => {
              const checked = selectedSet.has(option.value);
              const reason = unavailable(option);
              return (
                <button
                  type="button"
                  key={option.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={Boolean(reason)}
                  tabIndex={-1}
                  className={`hds-search-select__option${index === activeIndex ? ' is-active' : ''}`}
                  onPointerMove={() => {
                    if (!reason) setActive(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggle(option)}
                >
                  <span
                    className={`hds-multi-select__checkbox${checked ? ' is-checked' : ''}`}
                    aria-hidden="true"
                  >
                    {checked && <Check />}
                  </span>
                  <span className="hds-search-select__identity">
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                    {option.note && <small className="hds-multi-select__note">{option.note}</small>}
                    {reason && <small className="hds-search-select__unavailable">{reason}</small>}
                  </span>
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
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
          <div className="hds-multi-select__footer">
            <button type="button" onClick={() => setOpen(false)}>
              Selesai
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
