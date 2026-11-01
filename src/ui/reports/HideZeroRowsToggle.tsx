import "./HideZeroRowsToggle.css";

interface HideZeroRowsToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function HideZeroRowsToggle({
  checked,
  disabled = false,
  onChange,
}: HideZeroRowsToggleProps) {
  return (
    <label class="hide-zero-rows-toggle no-print">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange((event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>Hide zero / empty quantity rows</span>
    </label>
  );
}
