import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { incidentFixture } from "../features/investigation/fixture.ts";
import { InvestigationWorkspace } from "../features/investigation/workspace.tsx";
import { mintChatAccessToken, startChatSession } from "./actions.ts";

const chatIdSchema = z.string().uuid();

type HomePageProps = Readonly<{
  searchParams: Promise<{ chat?: string | string[] }>;
}>;

export default async function HomePage({ searchParams }: HomePageProps) {
  await connection();
  const parsedChatId = chatIdSchema.safeParse((await searchParams).chat);
  if (!parsedChatId.success) {
    redirect(`/?chat=${randomUUID()}`);
  }
  const chatId = parsedChatId.data;

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
        key={chatId}
        mintAccessTokenAction={mintAccessTokenAction}
        startSessionAction={startSessionAction}
      />
    </main>
  );
}
