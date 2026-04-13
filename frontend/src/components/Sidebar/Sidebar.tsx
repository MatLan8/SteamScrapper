import { NavLink } from "react-router-dom";
import styles from "./Sidebar.module.css";

const items = [
  { to: "/float-scraper", label: "Float Scraper", end: true },
  { to: "/sticker-scraper", label: "Sticker Scraper", disabled: true },
  { to: "/charm-scraper", label: "Charm Scraper", disabled: true },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>SteamScrapper</div>
      <nav className={styles.nav}>
        {items.map((item) =>
          item.disabled ? (
            <span key={item.to} className={styles.navDisabled} title="Coming soon">
              {item.label}
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? styles.navLinkActive : styles.navLink
              }
            >
              {item.label}
            </NavLink>
          ),
        )}
      </nav>
    </aside>
  );
}
