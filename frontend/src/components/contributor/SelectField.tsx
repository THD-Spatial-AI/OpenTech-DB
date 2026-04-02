/**
 * components/contributor/SelectField.tsx
 * ───────────────────────────────────────
 * Accessible, OEO-aware select component for the Contributor Workspace.
 *
 * Features
 * ────────
 * • Associates `<label>` with `<select>` via matching id/htmlFor.
 * • Shows an inline info tooltip (pure-CSS via Tailwind group/hover)
 *   next to the label when an `oeoTooltip` prop is provided.
 * • Surfaces Zod field errors beneath the control with role="alert".
 * • Visual required indicator (*) when `required` is true.
 * • Consistent focus ring using the app's indigo primary token.
 */

interface SelectFieldProps {
  id: string;
  name: string;
  label: string;
  /** The exhaustive list of allowed option values from the OEO. */
  options: string[];
  value: string;
  onChange: (value: string) => void;
  /** Zod validation error message for this field. */
  error?: string;
  required?: boolean;
  /**
   * Explanatory tooltip text for the OEO-controlled vocabulary field.
   * Shown via a hoverable ⓘ icon next to the label.
   */
  oeoTooltip?: string;
  /** Short caption rendered below the select (overridden by `error`). */
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
}

export default function SelectField({
  id,
  name,
  label,
  options,
  value,
  onChange,
  error,
  required,
  oeoTooltip,
  hint,
  placeholder = "— select —",
  disabled = false,
}: SelectFieldProps) {
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <label
          htmlFor={id}
          className="text-sm font-semibold text-on-surface leading-none"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-tertiary" aria-hidden="true">
              *
            </span>
          )}
        </label>

        {/* OEO info tooltip */}
        {oeoTooltip && (
          <span className="relative group">
            {/* Trigger icon */}
            <span
              className="material-symbols-outlined text-[16px] text-primary/50
                         cursor-help select-none align-middle leading-none"
              aria-label={`Info: ${oeoTooltip}`}
              role="img"
            >
              info
            </span>

            {/* Floating tooltip panel — pure-CSS, no JS */}
            <span
              role="tooltip"
              className="
                pointer-events-none absolute left-0 bottom-full mb-2 z-50
                w-72 rounded-lg bg-on-surface/95 text-surface
                text-xs font-normal leading-relaxed px-3 py-2.5 shadow-xl
                opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                transition-opacity duration-150
                whitespace-normal
              "
            >
              {oeoTooltip}
              {/* Tail */}
              <span
                className="absolute left-3 top-full w-0 h-0
                           border-x-4 border-x-transparent
                           border-t-4 border-t-on-surface/95"
              />
            </span>
          </span>
        )}
      </div>

      {/* Select control */}
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={required}
        aria-describedby={
          hasError
            ? `${id}-error`
            : hint
              ? `${id}-hint`
              : undefined
        }
        aria-invalid={hasError}
        className={[
          "w-full rounded-lg border bg-surface-container-lowest px-3 py-2.5",
          "text-sm text-on-surface appearance-none cursor-pointer",
          "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
          "transition-colors duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          hasError
            ? "border-tertiary ring-1 ring-tertiary/30"
            : "border-outline-variant/40 hover:border-outline-variant",
        ].join(" ")}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>

      {/* Error / hint */}
      {hasError ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-center gap-1 text-xs text-tertiary font-medium"
        >
          <span className="material-symbols-outlined text-[13px]">error</span>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-on-surface-variant/70">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
