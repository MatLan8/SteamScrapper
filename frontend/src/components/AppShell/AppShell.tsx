import { Outlet, useLocation } from "react-router-dom";
import PillNav from "@/components/PillNav";
import styles from "./AppShell.module.css";

const NAV_ITEMS = [
  { label: "Float Scraper", href: "/float-scraper" },
  { label: "Sticker Scraper", href: "/sticker-scraper" },
  { label: "Charm Scraper", href: "/charm-scraper" },
];

function activeHrefForPath(pathname: string): string {
  if (pathname === "/" || pathname === "/float-scraper") return "/float-scraper";
  return pathname;
}

export function AppShell() {
  const location = useLocation();
  const activeHref = activeHrefForPath(location.pathname);

  return (
    <div className={styles.layout}>
      <header className={styles.navWrap}>
        <PillNav
          logo="/favicon.svg"
          logoAlt="SteamScrapper"
          items={NAV_ITEMS}
          activeHref={activeHref}
          className={styles.pillNav}
          ease="power2.easeOut"
          baseColor="#262626"
          pillColor="#fafafa"
          hoveredPillTextColor="#fafafa"
          pillTextColor="#171717"
          initialLoadAnimation={false}
        />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
