import { randomUUID } from "node:crypto";
import Link from "next/link";
import { connection } from "next/server";

import { incidentFixture } from "../features/investigation/fixture.ts";
import { InvestigationWorkspace } from "../features/investigation/workspace.tsx";
import { mintChatAccessToken, startChatSession } from "./actions.ts";

export default async function HomePage() {
  await connection();
  const chatId = randomUUID();

  async function startSessionAction() {
    "use server";
    return startChatSession(chatId);
  }

  async function mintAccessTokenAction() {
    "use server";
    return mintChatAccessToken(chatId);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link aria-label="DeployLens home" className="brand" href="/">
          <span aria-hidden="true">D</span>
          DeployLens
        </Link>
        <span className="mode"><span aria-hidden="true" />Seeded incident · UTC</span>
      </header>
      <InvestigationWorkspace
        chatId={chatId}
        incident={incidentFixture}
        mintAccessTokenAction={mintAccessTokenAction}
        startSessionAction={startSessionAction}
      />
    </main>
  );
}
