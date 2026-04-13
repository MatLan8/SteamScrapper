import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import styles from "./ScraperMethodSelector.module.css";

export type MethodOption = {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type Props = {
  options: MethodOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
};

export function ScraperMethodSelector({
  options,
  value,
  onChange,
  label = "Transport",
}: Props) {
  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div className={styles.group} role="tablist">
        {options.map((opt) => {
          const disabled = Boolean(opt.disabled);
          const btn = (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={value === opt.id}
              disabled={disabled}
              className={
                disabled
                  ? styles.tabDisabled
                  : value === opt.id
                    ? styles.tabActive
                    : styles.tab
              }
              onClick={() => !disabled && onChange(opt.id)}
            >
              <span className={styles.tabLabel}>{opt.label}</span>
              {opt.description ? (
                <span className={styles.tabDesc}>{opt.description}</span>
              ) : null}
            </button>
          );

          if (disabled && opt.disabledReason) {
            return (
              <Tooltip key={opt.id}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent>
                  <p>{opt.disabledReason}</p>
                </TooltipContent>
              </Tooltip>
            );
          }
          return btn;
        })}
      </div>
    </div>
  );
}
