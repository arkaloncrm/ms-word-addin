import { useState } from "react";
import { Banner, Button } from "@/ui/primitives";
import {
  currentBuild,
  fetchLatestBuild,
  formatBuildTime,
  isNewerBuild,
  reloadPane,
  type BuildInfo,
} from "@/lib/updateCheck";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "available"; latest: BuildInfo }
  | { kind: "error" };

/**
 * Settings > Updates. ArkLaw loads from its website, so updates normally arrive
 * on their own the next time the pane opens; this lets a tester check now and
 * pick up a new version with one click, without reinstalling or restarting Word.
 */
export function UpdatesCard() {
  const [state, setState] = useState<CheckState>({ kind: "idle" });
  const built = formatBuildTime(currentBuild.buildId);

  async function check() {
    setState({ kind: "checking" });
    const latest = await fetchLatestBuild();
    if (!latest) setState({ kind: "error" });
    else if (isNewerBuild(currentBuild, latest)) setState({ kind: "available", latest });
    else setState({ kind: "latest" });
  }

  return (
    <div className="card settings-card">
      <h2 className="settings-heading">Updates</h2>
      <p className="small muted settings-heading__hint">
        You're running ArkLaw {currentBuild.version}
        {built ? `, released ${built}` : ""}. New versions install themselves the next time you open
        ArkLaw; check here to get one straight away. Nothing needs reinstalling.
      </p>
      {state.kind === "latest" && (
        <p className="small" role="status" style={{ margin: 0 }}>
          You have the latest version.
        </p>
      )}
      {state.kind === "error" && (
        <p className="small muted" role="status" style={{ margin: 0 }}>
          Couldn't check right now. Close and reopen ArkLaw to get the latest version.
        </p>
      )}
      {state.kind === "available" && (
        <Banner tone="info">
          <p className="small" style={{ margin: 0 }}>
            A newer version is ready
            {formatBuildTime(state.latest.buildId) ? ` (released ${formatBuildTime(state.latest.buildId)})` : ""}.
            Updating reloads ArkLaw; your document is not affected, but any open suggestion cards are cleared.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <Button variant="primary" size="sm" onClick={reloadPane}>
              Update now
            </Button>
          </div>
        </Banner>
      )}
      {state.kind !== "available" && (
        <Button
          variant="default"
          size="sm"
          onClick={() => void check()}
          loading={state.kind === "checking"}
          style={{ alignSelf: "flex-start" }}
        >
          Check for updates
        </Button>
      )}
    </div>
  );
}
