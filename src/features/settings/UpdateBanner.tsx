import { useEffect, useState } from "react";
import { Banner, Button } from "@/ui/primitives";
import { currentBuild, fetchLatestBuild, isNewerBuild, reloadPane } from "@/lib/updateCheck";

/** How often an open pane looks for a newer version. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * A quiet banner when a newer ArkLaw is live while this pane is open (or Word
 * served an old cached copy). Checks on open and every 30 minutes; one click
 * reloads the pane. Never reloads by itself, so nothing on screen is lost
 * without the lawyer choosing it.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const latest = await fetchLatestBuild();
      if (alive && isNewerBuild(currentBuild, latest)) setReady(true);
    };
    void check();
    const t = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!ready || dismissed) return null;
  return (
    <Banner tone="info">
      <p className="small" style={{ margin: 0 }}>
        A newer version of ArkLaw is ready. Update when convenient: it reloads ArkLaw (your document is
        not affected).
      </p>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <Button variant="primary" size="sm" onClick={reloadPane}>
          Update now
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Later
        </Button>
      </div>
    </Banner>
  );
}
