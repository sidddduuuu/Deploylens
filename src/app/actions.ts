import "server-only";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { z } from "zod";

const chatIdSchema = z.string().uuid();
const startAgentSession = chat.createStartSessionAction("deploylens-agent");

export async function startChatSession(chatIdInput: string) {
  const chatId = chatIdSchema.parse(chatIdInput);
  return startAgentSession({ chatId });
}

export async function mintChatAccessToken(chatIdInput: string) {
  const chatId = chatIdSchema.parse(chatIdInput);
  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });
}

export type StartChatSessionResult = Awaited<ReturnType<typeof startChatSession>>;
export type ChatAccessToken = Awaited<ReturnType<typeof mintChatAccessToken>>;
