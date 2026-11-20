import type { ReactNode } from "react";

/** App header: the ArkLaw scales mark plus the ArkLaw wordmark. */
export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="row" style={{ gap: 8 }}>
        <img src="/assets/icon-80.png" width={22} height={22} alt="" className="app-header__mark" />
        <span className="app-header__wordmark">ArkLaw</span>
      </div>
      {right}
    </header>
  );
}
