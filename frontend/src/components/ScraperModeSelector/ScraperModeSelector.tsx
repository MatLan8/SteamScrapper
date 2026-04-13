import styles from "./ScraperModeSelector.module.css";

export type ModeOption = {
  id: string;
  label: string;
  description?: string;
};

type Props = {
  options: ModeOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
};

export function ScraperModeSelector({
  options,
  value,
  onChange,
  label = "Scraper mode",
}: Props) {
  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div className={styles.group} role="tablist">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={value === opt.id}
            className={value === opt.id ? styles.tabActive : styles.tab}
            onClick={() => onChange(opt.id)}
          >
            <span className={styles.tabLabel}>{opt.label}</span>
            {opt.description ? (
              <span className={styles.tabDesc}>{opt.description}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
