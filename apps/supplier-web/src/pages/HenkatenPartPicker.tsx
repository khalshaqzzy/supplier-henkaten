import { Check, ChevronDown, Package, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Popover } from '@tmmin-henkaten/ui';

import './henkaten-part-picker.css';

export interface PartChoice {
  id: string;
  partNumber: string;
  partName: string;
}

export interface PartSelection {
  parts: readonly PartChoice[];
  /** Undisclosed part outside the catalog. Mutually exclusive with `parts`. */
  other: boolean;
}

export const OTHER_PART_VALUE = 'OTHER';
const SEARCH_DELAY_MS = 250;

/**
 * Multi-select picker for the parts affected by one Henkaten. The catalog is searched on the
 * server, so the committed selection is kept apart from the visible result page and stays
 * intact while the search text changes.
 */
export function HenkatenPartPicker({
  id,
  value,
  onChange,
  results,
  resultLimit,
  loading = false,
  onSearch,
  max,
  disabled = false,
}: {
  id: string;
  value: PartSelection;
  onChange: (next: PartSelection) => void;
  /** Catalog parts matching the current search, as returned by the server. */
  results: readonly PartChoice[];
  /** Server page size; reaching it means more parts exist than are listed. */
  resultLimit: number;
  loading?: boolean;
  onSearch: (text: string) => void;
  max: number;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => onSearch(search.trim()), search ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
    // `onSearch` is intentionally not a dependency: only typed text schedules a search.
  }, [search]);

  const selectedIds = new Set(value.parts.map((part) => part.id));
  const full = value.parts.length >= max;
  const choices = [
    ...results.map((part) => ({
      value: part.id,
      part,
      label: part.partNumber,
      description: part.partName,
      selected: selectedIds.has(part.id),
      disabledReason: full && !selectedIds.has(part.id) ? `Maksimal ${max} part` : undefined,
    })),
    ...(search.trim()
      ? []
      : [
          {
            value: OTHER_PART_VALUE,
            part: undefined,
            label: 'Other',
            description: 'Part di luar katalog',
            selected: value.other,
            disabledReason: undefined,
          },
        ]),
  ];
  const enabled = choices.flatMap((choice, index) => (choice.disabledReason ? [] : [index]));
  const activeIndex = enabled.includes(active) ? active : (enabled[0] ?? -1);

  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const toggle = (choice: (typeof choices)[number]) => {
    if (choice.disabledReason) return;
    if (!choice.part) {
      // Other replaces any catalog selection, so there is nothing left to pick.
      onChange({ parts: [], other: !value.other });
      if (!value.other) close();
      return;
    }
    onChange({
      other: false,
      parts: choice.selected
        ? value.parts.filter(({ id: partId }) => partId !== choice.value)
        : [...value.parts, choice.part],
    });
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
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
      const choice = choices[activeIndex];
      if (choice) toggle(choice);
    }
  };

  const count = value.parts.length;
  const summary = value.other
    ? 'Other'
    : count === 0
      ? 'Pilih part'
      : count === 1
        ? value.parts[0]!.partNumber
        : `${count} part dipilih`;
  const summaryDetail = value.other
    ? 'Part di luar katalog'
    : count === 1
      ? value.parts[0]!.partName
      : count > 1
        ? value.parts.map((part) => part.partNumber).join(', ')
        : '';

  return (
    <div className="part-picker">
      <Popover
        ariaLabel="Pilih part"
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
            ref={trigger}
            id={id}
            type="button"
            className="hds-search-select__trigger part-picker__trigger"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-describedby={`${id}-summary`}
          >
            <Package aria-hidden="true" />
            <span className="hds-search-select__identity" id={`${id}-summary`}>
              <span className={count || value.other ? '' : 'is-placeholder'}>{summary}</span>
              {summaryDetail && (
                <small className="part-picker__trigger-detail">{summaryDetail}</small>
              )}
            </span>
            <ChevronDown aria-hidden="true" className={open ? 'is-open' : ''} />
          </button>
        }
      >
        <div className="hds-search-select__popup part-picker__popup">
          <div className="hds-search-select__search">
            <Search aria-hidden="true" />
            <input
              role="combobox"
              aria-label="Cari part"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
              }
              autoComplete="off"
              placeholder="Cari nomor atau nama part…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActive(0);
              }}
              onKeyDown={keyboard}
            />
          </div>
          <div className="hds-search-select__meta part-picker__meta" role="status">
            <span>{value.other ? 'Other dipilih' : `${count} dari maksimal ${max} dipilih`}</span>
            {loading && <span>Mencari…</span>}
          </div>
          <div
            id={listId}
            ref={list}
            role="listbox"
            aria-label="Daftar part"
            aria-multiselectable="true"
            className="hds-search-select__list"
          >
            {choices.map((choice, index) => (
              <button
                type="button"
                key={choice.value}
                id={`${listId}-option-${index}`}
                role="option"
                data-value={choice.value}
                aria-selected={choice.selected}
                aria-disabled={Boolean(choice.disabledReason)}
                tabIndex={-1}
                className={`hds-search-select__option part-picker__option${
                  index === activeIndex ? ' is-active' : ''
                }`}
                onPointerMove={() => {
                  if (!choice.disabledReason) setActive(index);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(choice)}
              >
                <span
                  className={`part-picker__box${choice.selected ? ' is-checked' : ''}${
                    choice.part ? '' : ' is-radio'
                  }`}
                  aria-hidden="true"
                >
                  {choice.selected && <Check />}
                </span>
                <span className="hds-search-select__identity">
                  <strong>{choice.label}</strong>
                  {choice.description && <small>{choice.description}</small>}
                  {choice.disabledReason && (
                    <small className="hds-search-select__unavailable">
                      {choice.disabledReason}
                    </small>
                  )}
                </span>
              </button>
            ))}
          </div>
          {results.length === 0 && search.trim() && !loading && (
            <div className="hds-search-select__empty">
              <Search aria-hidden="true" />
              <strong>Part tidak ditemukan</strong>
              <button type="button" onClick={() => setSearch('')}>
                Bersihkan pencarian
              </button>
            </div>
          )}
          {results.length >= resultLimit && (
            <p className="part-picker__hint">
              Menampilkan {resultLimit} part pertama. Ketik untuk mempersempit.
            </p>
          )}
          <div className="part-picker__footer">
            <button type="button" className="part-picker__done" onClick={close}>
              Selesai
            </button>
          </div>
        </div>
      </Popover>
      {(count > 0 || value.other) && (
        <div className="part-picker__selection">
          <div className="part-picker__selection-head">
            <span>{value.other ? 'Part dipilih' : `Part dipilih (${count})`}</span>
            {count > 1 && (
              <button type="button" onClick={() => onChange({ parts: [], other: false })}>
                Hapus semua
              </button>
            )}
          </div>
          <ul className="part-picker__chips" aria-label="Pilihan part">
            {value.other ? (
              <SelectedRow
                label="Other"
                detail="Part di luar katalog"
                onRemove={() => onChange({ parts: [], other: false })}
              />
            ) : (
              value.parts.map((part) => (
                <SelectedRow
                  key={part.id}
                  label={part.partNumber}
                  detail={part.partName}
                  onRemove={() =>
                    onChange({
                      other: false,
                      parts: value.parts.filter(({ id: partId }) => partId !== part.id),
                    })
                  }
                />
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function SelectedRow({
  label,
  detail,
  onRemove,
}: {
  label: string;
  detail: string;
  onRemove: () => void;
}) {
  return (
    <li className="part-picker__chip">
      <span className="part-picker__chip-text">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <button type="button" aria-label={`Hapus pilihan part ${label}`} onClick={onRemove}>
        <X aria-hidden="true" />
      </button>
    </li>
  );
}

/** Compact part cell: the first part plus a count of the remaining ones. */
export function PartSummary({ parts }: { parts: ReadonlyArray<{ number: string; name: string }> }) {
  const [first, ...rest] = parts;
  if (!first) return null;
  return (
    <div className="henkaten-table__stack part-summary">
      <strong>
        {first.number}
        {rest.length > 0 && (
          <span
            className="part-summary__more"
            title={rest.map((part) => part.number).join(', ')}
            aria-label={`dan ${rest.length} part lain`}
          >
            +{rest.length}
          </span>
        )}
      </strong>
      <small>{first.name}</small>
    </div>
  );
}
