import { useEffect, useState } from "react";

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m} min ${s} sec`;
}

/**
 * Count-up timer while `active` is true. Resets when `active` becomes false.
 * Format: "42s" under 60s, then "1m 5s" style after.
 */
export function useElapsedTimer(active: boolean): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setLabel(null);
      return;
    }

    const start = Date.now();
    const tick = () => {
      const sec = Math.floor((Date.now() - start) / 1000);
      setLabel(formatElapsed(sec));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return active ? label : null;
}
