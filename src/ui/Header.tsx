import type { ReactNode } from "react";

/**
 * App header shown before setup is finished (the first screen a new user sees):
 * the full ArkLaw logo, ark and document symbol plus wordmark, as crisp vector
 * art. Once signed in, the compact app bar shows the symbol alone.
 */
export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="app-header">
      <img
        src="/assets/brand/arklaw-logo-horizontal.svg"
        alt="ArkLaw"
        height={28}
        width={149}
        className="app-header__logo"
      />
      {right}
    </header>
  );
}
