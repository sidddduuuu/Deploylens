import Link from "next/link";

import { incidentFixture } from "../features/investigation/fixture.ts";
import { InvestigationWorkspace } from "../features/investigation/workspace.tsx";

export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link aria-label="DeployLens home" className="brand" href="/">
          <span aria-hidden="true">D</span>
          DeployLens
        </Link>
        <span className="mode"><span aria-hidden="true" />Seeded incident · UTC</span>
      </header>
      <InvestigationWorkspace incident={incidentFixture} />
    </main>
  );
}
