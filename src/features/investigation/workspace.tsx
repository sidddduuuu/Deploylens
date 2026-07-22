"use client";

import { useChat } from "@ai-sdk/react";
import {
  useTriggerChatTransport,
  type InferChatUIMessage,
} from "@trigger.dev/sdk/chat/react";
import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { z } from "zod";

import type {
  ChatAccessToken,
  StartChatSessionResult,
} from "../../app/actions.ts";
import type { deploylensAgent } from "../../trigger/deploylens.ts";
import {
  classifyInvestigationQuestion,
  investigationQuestionSchema,
  type IncidentResult,
} from "./schema.ts";
import {
  deriveMessageState,
  unsupportedQuestionMessage,
  type InvestigationMessageState,
} from "./message-state.ts";
import { ActiveIncidentEvidence } from "./incident-preview.tsx";

type DeployLensMessage = InferChatUIMessage<typeof deploylensAgent>;

const storedSessionSchema = z
  .object({
    publicAccessToken: z.string().min(1),
    lastEventId: z.string().min(1).optional(),
    isStreaming: z.boolean().optional(),
  })
  .strict();

const storedResumeSchema = z
  .object({
    question: investigationQuestionSchema,
    session: storedSessionSchema,
  })
  .strict();

type StoredResume = Readonly<{
  question: string;
  session: ChatSessionPersistedState;
}>;

function resumeStorageKey(chatId: string) {
  return `deploylens:chat:${chatId}:resume`;
}

function parseStoredResume(stored: string | null): StoredResume | undefined {
  try {
    if (!stored) return undefined;
    const { question, session } = storedResumeSchema.parse(JSON.parse(stored));
    return {
      question,
      session: {
        publicAccessToken: session.publicAccessToken,
        ...(session.lastEventId === undefined ? {} : { lastEventId: session.lastEventId }),
        ...(session.isStreaming === undefined ? {} : { isStreaming: session.isStreaming }),
      },
    };
  } catch {
    return undefined;
  }
}

function persistResume(chatId: string, resume: StoredResume | null) {
  if (typeof window === "undefined") return;
  try {
    const key = resumeStorageKey(chatId);
    if (resume) window.sessionStorage.setItem(key, JSON.stringify(resume));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage is a refresh enhancement; the active chat remains usable without it.
  }
}

function resumedMessages(chatId: string, resume: StoredResume | undefined) {
  if (!resume) return [];
  return [{
    id: `resumed-${chatId}`,
    parts: [{ text: resume.question, type: "text" }],
    role: "user",
  }] satisfies DeployLensMessage[];
}

function subscribeStoredResume() {
  return () => undefined;
}

function serverStoredResume() {
  return null;
}

function useStoredResume(chatId: string) {
  const getSnapshot = useCallback(() => {
    try {
      return window.sessionStorage.getItem(resumeStorageKey(chatId));
    } catch {
      return null;
    }
  }, [chatId]);
  const stored = useSyncExternalStore(subscribeStoredResume, getSnapshot, serverStoredResume);

  return useMemo(() => parseStoredResume(stored), [stored]);
}

function Conversation({ messages, state, busy, onRetry }: Readonly<{
  messages: readonly DeployLensMessage[];
  state: InvestigationMessageState;
  busy: boolean;
  onRetry: () => void;
}>) {
  const failure = state.kind === "schema-invalid" || state.kind === "tool-error" || state.kind === "unsupported"
    ? state
    : undefined;

  return (
    <div className="conversation">
      <div aria-live="polite" aria-relevant="additions text" role="log">
        <ol className="message-log">
          {messages.length === 0 ? (
            <li className="message message-system">
              <span>DeployLens</span>
              <p>Ready to investigate the seeded checkout incident.</p>
            </li>
          ) : null}
          {messages.map((message) => message.parts.map((part, index) => part.type === "text" ? (
            <li className={`message message-${message.role === "user" ? "user" : "system"}`} key={`${message.id}-${index}`}>
              <span>{message.role === "user" ? "You" : "DeployLens"}</span>
              <p>{part.text}</p>
            </li>
          ) : null))}
        </ol>
      </div>
      {state.progress.length > 0 ? (
        <div aria-live="polite" className="message message-system progress-message" role="status">
          <span>Analysis progress</span>
          <ul className="progress-list">
            {state.progress.map(({ label, status }) => (
              <li key={label}>
                <span aria-hidden="true">
                  {status === "complete" ? "✓" : status === "failed" ? "×" : "·"}
                </span>
                {label}
                <em>{status}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {failure ? (
        <div aria-live="polite" className="message message-system" role="status">
          <p className="composer-error">{failure.message}</p>
          {failure.retryable ? (
            <button className="primary-button" disabled={busy} onClick={onRetry} type="button">
              Retry investigation
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Composer({ initialQuestion, busy, onSubmit }: Readonly<{
  initialQuestion: string;
  busy: boolean;
  onSubmit: (question: string) => string | undefined;
}>) {
  const [draft, setDraft] = useState(initialQuestion);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question) {
      setError("Enter a question about checkout conversion.");
      return;
    }
    setError(onSubmit(question) ?? null);
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="incident-question">Ask about checkout</label>
      <textarea
        aria-describedby={`question-help${error ? " question-error" : ""}`}
        aria-invalid={error !== null}
        disabled={busy}
        id="incident-question"
        maxLength={500}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        required
        rows={3}
        value={draft}
      />
      <p className="composer-help" id="question-help">Runs the seeded checkout investigation.</p>
      {error ? <p className="composer-error" id="question-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={busy} type="submit">
        {busy ? "Investigating…" : "Investigate"}
      </button>
    </form>
  );
}

function EvidenceStatus({ state }: Readonly<{ state: InvestigationMessageState }>) {
  const failed = state.kind === "schema-invalid" || state.kind === "tool-error";
  const title = state.kind === "unsupported"
    ? "This question is outside the demo scope"
    : failed
      ? "No live incident result was produced"
      : "Building the incident evidence";

  return (
    <section aria-live="polite" className="evidence-pane evidence-status">
      <p className="eyebrow">Live evidence</p>
      <h2>{title}</h2>
      <p>{state.kind === "unsupported"
        ? unsupportedQuestionMessage
        : failed
          ? "Retry to run the investigation again. Stale evidence has not been shown."
          : "The card will appear only after the streamed tool output passes validation."}</p>
    </section>
  );
}

type InvestigationWorkspaceProps = Readonly<{
  incident: IncidentResult;
  chatId: string;
  mintAccessTokenAction: () => Promise<ChatAccessToken>;
  startSessionAction: () => Promise<StartChatSessionResult>;
}>;

type InvestigationChatProps = InvestigationWorkspaceProps & Readonly<{
  restoredResume?: StoredResume;
}>;

function InvestigationChat({
  incident,
  chatId,
  mintAccessTokenAction,
  restoredResume,
  startSessionAction,
}: InvestigationChatProps) {
  const submissionLock = useRef(false);
  const [initialMessages] = useState(() => resumedMessages(chatId, restoredResume));
  const latestQuestion = useRef(restoredResume?.question);
  const turnSnapshotSaved = useRef(Boolean(restoredResume));
  const transport = useTriggerChatTransport<typeof deploylensAgent>({
    task: "deploylens-agent",
    accessToken: () => mintAccessTokenAction(),
    onSessionChange: (changedChatId, session) => {
      if (changedChatId !== chatId) return;
      if (!session) {
        turnSnapshotSaved.current = false;
        persistResume(chatId, null);
        return;
      }
      if (session.isStreaming === false) {
        turnSnapshotSaved.current = false;
        return;
      }
      if (session.isStreaming && !turnSnapshotSaved.current && latestQuestion.current) {
        persistResume(chatId, { question: latestQuestion.current, session });
        turnSnapshotSaved.current = true;
      }
    },
    ...(restoredResume ? { sessions: { [chatId]: restoredResume.session } } : {}),
    startSession: () => startSessionAction(),
  });
  const { clearError, messages, regenerate, sendMessage, status } = useChat<DeployLensMessage>({
    id: chatId,
    messages: initialMessages,
    resume: initialMessages.length > 0,
    transport,
  });
  const messageState = deriveMessageState(messages, status);
  const currentIncident = messageState.kind === "valid"
    ? messageState.incident
    : messageState.kind === "initial"
      ? incident
      : undefined;
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!busy) submissionLock.current = false;
  }, [busy]);

  function investigate(question: string) {
    if (!classifyInvestigationQuestion(question)) return unsupportedQuestionMessage;
    if (submissionLock.current || busy) return "Wait for the current investigation to finish.";
    submissionLock.current = true;
    latestQuestion.current = question;
    void sendMessage({ text: question }).catch(() => {
      submissionLock.current = false;
    });
  }

  function retry() {
    if (submissionLock.current || busy) return;
    submissionLock.current = true;
    clearError();
    void regenerate().catch(() => {
      submissionLock.current = false;
    });
  }

  return (
    <div className="workspace">
      <aside aria-labelledby="conversation-title" className="chat-rail">
        <div className="chat-heading">
          <p className="eyebrow">Investigation</p>
          <h1 id="conversation-title">Checkout conversion</h1>
          <p>Ask one question. The evidence stays linked as you narrow the incident.</p>
        </div>
        <Conversation busy={busy} messages={messages} onRetry={retry} state={messageState} />
        <Composer busy={busy} initialQuestion={incident.question} onSubmit={investigate} />
      </aside>
      {currentIncident ? (
        <ActiveIncidentEvidence
          incident={currentIncident}
          key={`${currentIncident.incidentId}:${currentIncident.generatedAt}:${currentIncident.defaultViewId}`}
          preview={messageState.kind === "initial"}
        />
      ) : (
        <EvidenceStatus state={messageState} />
      )}
    </div>
  );
}

export function InvestigationWorkspace(props: InvestigationWorkspaceProps) {
  const restoredResume = useStoredResume(props.chatId);

  return (
    <InvestigationChat
      {...props}
      key={restoredResume ? "restored" : "new"}
      {...(restoredResume ? { restoredResume } : {})}
    />
  );
}
