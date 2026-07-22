import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { incidentFixture } from "../../features/investigation/fixture.ts";
import { InvestigationWorkspace } from "../../features/investigation/workspace.tsx";
import { mintChatAccessToken, startChatSession } from "../actions.ts";

const chatIdSchema = z.string().uuid();

export const metadata: Metadata = {
  description: "Investigate the seeded checkout incident with linked, validated evidence.",
  title: "Investigation",
};

type WorkspacePageProps = Readonly<{
  searchParams: Promise<{ chat?: string | string[] }>;
}>;

export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  await connection();
  const parsedChatId = chatIdSchema.safeParse((await searchParams).chat);
  if (!parsedChatId.success) {
    redirect(`/app?chat=${randomUUID()}`);
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
