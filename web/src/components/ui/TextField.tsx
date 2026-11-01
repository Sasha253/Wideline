"use client";

import { ChevronDown, CircleAlert } from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "./cx";
import { iconProps } from "./icons";

/*
 * Text fields, selects and the search-select (Floodlight, "Input and select" in
 * design/Wideline Components.dc.html).
 *
 * - The label always sits above the field. Placeholders show format only ("mm:ss",
 *   "name@club.co.za"), never instructions.
 * - Errors add a rejected border plus a 1px ring and a message with circle-alert that says
 *   how to fix it ("Use a time between 00:00 and 92:10"). The error replaces the help.
 * - Time and number fields use `mono` (JetBrains Mono, tabular figures).
 * - Select for fixed lists under 12 items (position, age band); SearchSelect above that
 *   (player, club). Validate when the user leaves the field, not on every keystroke.
 * - Never disable a field to hide data: use read-only text so it can be copied.
 */

type FieldShellProps = {
  /** Visible label. A node allows a hidden suffix (<span className="sr-only">…</span>). */
  label: ReactNode;
  /** Help under the field ("Match clock, from kickoff"). Replaced by the error. */
  help?: ReactNode;
  /** The fix, in words. Sets aria-invalid and the rejected border. */
  error?: string;
  /** JetBrains Mono with tabular figures, for times and numbers. */
  mono?: boolean;
  /** Class on the outer wrapper (layout: width, grid placement). */
  className?: string;
};

type ShellRender = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

function FieldShell({
  label,
  help,
  error,
  disabled,
  className,
  id: idProp,
  children,
}: FieldShellProps & {
  disabled?: boolean;
  id?: string;
  children: (r: ShellRender) => ReactNode;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const noteId = `${id}-note`;
  const hasNote = Boolean(error) || Boolean(help);
  return (
    <div className={cx("wl-field", disabled && "wl-field--disabled", className)}>
      <label htmlFor={id} id={`${id}-label`} className="wl-field__label">
        {label}
      </label>
      {children({ id, describedBy: hasNote ? noteId : undefined, invalid: Boolean(error) })}
      {error ? (
        <FieldMessage id={noteId} error>
          {error}
        </FieldMessage>
      ) : help ? (
        <FieldMessage id={noteId}>{help}</FieldMessage>
      ) : null}
    </div>
  );
}

/** The help or error line under a field. Errors carry the circle-alert icon. */
export function FieldMessage({
  id,
  error = false,
  children,
}: {
  id?: string;
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <p id={id} className={error ? "wl-field__error" : "wl-field__hint"}>
      {error && <CircleAlert {...iconProps} />}
      <span>{children}</span>
    </p>
  );
}

type TextFieldProps = FieldShellProps &
  Omit<ComponentProps<"input">, "className"> & {
    /** A 16px icon at the end of the field, e.g. <Clock {...iconProps} /> for a time. */
    trailing?: ReactNode;
    /** Class on the <input>. */
    inputClassName?: string;
  };

/** A labelled text input (email, name, time, number). */
export function TextField({
  label,
  help,
  error,
  mono = false,
  className,
  trailing,
  inputClassName,
  id,
  disabled,
  ...input
}: TextFieldProps) {
  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      disabled={disabled}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <div className="wl-control" data-invalid={invalid || undefined}>
          <input
            id={inputId}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cx("wl-control__input", mono && "wl-mono", inputClassName)}
            {...input}
          />
          {trailing && (
            <span className="wl-control__icon" aria-hidden="true">
              {trailing}
            </span>
          )}
        </div>
      )}
    </FieldShell>
  );
}

type TextAreaProps = FieldShellProps &
  Omit<ComponentProps<"textarea">, "className"> & { inputClassName?: string };

/** A labelled multi-line field (reasons, notes). */
export function TextArea({
  label,
  help,
  error,
  mono = false,
  className,
  inputClassName,
  id,
  disabled,
  ...textarea
}: TextAreaProps) {
  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      disabled={disabled}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <textarea
          id={inputId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx("wl-input", mono && "wl-mono", inputClassName)}
          {...textarea}
        />
      )}
    </FieldShell>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectProps = FieldShellProps &
  Omit<ComponentProps<"select">, "className"> & {
    /** The options. Or pass <option> children. */
    options?: SelectOption[];
    /** A first, empty option ("Choose a position"), selected until the user picks one. */
    placeholder?: string;
    inputClassName?: string;
  };

/** A labelled native select, for fixed lists under 12 items. */
export function Select({
  label,
  help,
  error,
  mono = false,
  className,
  options,
  placeholder,
  inputClassName,
  id,
  disabled,
  children,
  ...select
}: SelectProps) {
  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      disabled={disabled}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <div className="wl-control wl-control--select" data-invalid={invalid || undefined}>
          <select
            id={inputId}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cx("wl-control__input", mono && "wl-mono", inputClassName)}
            {...select}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options?.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
            {children}
          </select>
          <span className="wl-control__icon" aria-hidden="true">
            <ChevronDown {...iconProps} />
          </span>
        </div>
      )}
    </FieldShell>
  );
}

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Mono, muted, before the label: the shirt number ("9"). */
  prefix?: string;
  /** Muted, after the label: position, club, age group. */
  hint?: string;
  disabled?: boolean;
};

type SearchSelectProps = FieldShellProps & {
  options: SearchSelectOption[];
  /** Posts the chosen value under this name (a hidden input). */
  name?: string;
  /** Controlled value. */
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null, option: SearchSelectOption | null) => void;
  /** Format only, e.g. "Name or shirt number". */
  placeholder?: string;
  /** Shown when nothing matches what was typed. */
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  /** Called when focus leaves the field: validate here. */
  onBlur?: () => void;
};

const normalise = (s: string) => s.toLocaleLowerCase("en-ZA").trim();

/**
 * A labelled combobox for long lists (player, club): type to filter, arrow keys to move,
 * Enter to choose, Esc to close. Implements the ARIA combobox pattern with a listbox
 * popup; the chosen value posts through a hidden input when `name` is set.
 */
export function SearchSelect({
  label,
  help,
  error,
  mono = false,
  className,
  options,
  name,
  value: valueProp,
  defaultValue = null,
  onValueChange,
  placeholder,
  emptyText = "No matches",
  disabled = false,
  required,
  id,
  onBlur,
}: SearchSelectProps) {
  const [inner, setInner] = useState<string | null>(defaultValue);
  const value = valueProp !== undefined ? valueProp : inner;
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    if (!query) return options;
    const q = normalise(query);
    return options.filter(
      (o) =>
        normalise(o.label).includes(q) ||
        (o.prefix !== undefined && normalise(o.prefix).startsWith(q)),
    );
  }, [options, query]);

  function choose(option: SearchSelectOption | null) {
    if (option?.disabled) return;
    if (valueProp === undefined) setInner(option?.value ?? null);
    onValueChange?.(option?.value ?? null, option);
    setQuery(null);
    setOpen(false);
  }

  function openList(at = 0) {
    setOpen(true);
    setActive(Math.max(0, Math.min(at, matches.length - 1)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList(selected ? matches.indexOf(selected) : 0);
        else setActive((i) => Math.min(i + 1, matches.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList(matches.length - 1);
        else setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActive(matches.length - 1);
        }
        break;
      case "Enter":
        if (open) {
          e.preventDefault();
          const option = matches[active];
          if (option) choose(option);
        }
        break;
      case "Escape":
        if (open || query !== null) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setQuery(null);
        }
        break;
    }
  }

  const activeId = open && matches[active] ? `${listId}-${active}` : undefined;
  const showPrefix = query === null && selected?.prefix !== undefined;

  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      disabled={disabled}
      className={className}
      id={id}
    >
      {({ id: inputId, describedBy, invalid }) => (
        <div className="wl-search-select">
          <div className="wl-control" data-invalid={invalid || undefined}>
            {showPrefix && (
              <span className="wl-control__prefix" aria-hidden="true">
                {selected?.prefix}
              </span>
            )}
            <input
              id={inputId}
              type="text"
              role="combobox"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              aria-required={required || undefined}
              disabled={disabled}
              placeholder={placeholder}
              className={cx("wl-control__input", mono && "wl-mono")}
              value={query ?? selected?.label ?? ""}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActive(0);
                if (e.target.value === "" && !required) choose(null);
              }}
              onClick={() => !open && openList(selected ? matches.indexOf(selected) : 0)}
              onKeyDown={onKeyDown}
              onBlur={() => {
                setOpen(false);
                setQuery(null);
                onBlur?.();
              }}
            />
            <span className="wl-control__icon" aria-hidden="true">
              <ChevronDown {...iconProps} />
            </span>
          </div>
          {name && <input type="hidden" name={name} value={value ?? ""} />}
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={`${inputId}-label`}
            className="wl-listbox"
            hidden={!open}
          >
            {matches.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                data-active={i === active || undefined}
                className="wl-listbox__option"
                // Keep focus in the input, so blur does not close the list before the click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(o)}
              >
                {o.prefix !== undefined && <span className="wl-listbox__prefix">{o.prefix}</span>}
                <span className="wl-listbox__label">{o.label}</span>
                {o.hint && <span className="wl-listbox__hint">{o.hint}</span>}
              </li>
            ))}
            {open && matches.length === 0 && (
              <li className="wl-listbox__empty" role="presentation">
                {emptyText}
              </li>
            )}
          </ul>
        </div>
      )}
    </FieldShell>
  );
}
