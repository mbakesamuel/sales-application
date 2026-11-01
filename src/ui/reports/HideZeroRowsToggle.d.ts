import "./HideZeroRowsToggle.css";
interface HideZeroRowsToggleProps {
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
}
export declare function HideZeroRowsToggle({ checked, disabled, onChange, }: HideZeroRowsToggleProps): import("preact").JSX.Element;
export {};
