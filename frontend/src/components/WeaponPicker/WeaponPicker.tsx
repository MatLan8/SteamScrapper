import styles from "./WeaponPicker.module.css";

const WEAPON_CATEGORIES = [
  {
    label: "Pistols",
    weapons: [
      "Glock-18",
      "P2000",
      "USP-S",
      "Dual Berettas",
      "P250",
      "Five-SeveN",
      "Tec-9",
      "CZ75-Auto",
      "Desert Eagle",
      "R8 Revolver",
    ],
  },
  {
    label: "SMGs",
    weapons: ["MAC-10", "MP9", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon"],
  },
  {
    label: "Rifles",
    weapons: [
      "Galil AR",
      "FAMAS",
      "AK-47",
      "M4A4",
      "M4A1-S",
      "SSG 08",
      "SG 553",
      "AUG",
      "AWP",
    ],
  },
  {
    label: "Heavy",
    weapons: ["Nova", "XM1014", "MAG-7", "Sawed-Off", "M249", "Negev"],
  },
  { label: "Other", weapons: ["Zeus x27"] },
] as const;

type Props = {
  value: string;
  onChange: (weapon: string) => void;
};

export function WeaponPicker({ value, onChange }: Props) {
  return (
    <div className={styles.root}>
      <h3 className={styles.sectionTitle}>Choose weapon</h3>
      {WEAPON_CATEGORIES.map((cat) => (
        <div key={cat.label} className={styles.category}>
          <div className={styles.divider} aria-hidden />
          <div className={styles.categoryLabel}>{cat.label}</div>
          <div className={styles.buttonRow}>
            {cat.weapons.map((w) => (
              <button
                key={w}
                type="button"
                className={
                  value === w ? `${styles.btn} ${styles.btnSelected}` : styles.btn
                }
                onClick={() => onChange(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
