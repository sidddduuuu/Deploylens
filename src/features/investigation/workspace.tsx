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

const mobileFollowUp = "Show only mobile traffic";

const storedSessionSchema = z
  .object({
    publicAccessToken: z.string().min(1),
    lastEventId: z.string().min(1).optional(),
    isStreaming: z.literal(true),
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
        isStreaming: true,
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

function stateLabel(state: InvestigationMessageState, reconnecting: boolean) {
  if (reconnecting && state.kind === "pending") return "Reconnecting";
  if (state.kind === "initial") return "Example";
  if (state.kind === "pending") return "Investigating";
  if (state.kind === "valid") return "Validated";
  if (state.kind === "unsupported") return "Scope limited";
  return "Failed";
}

function statusAnnouncement(state: InvestigationMessageState, reconnecting: boolean) {
  if (reconnecting && state.kind === "pending") return "Reconnecting to this investigation.";
  if (state.kind === "initial") return "Example result. No live investigation has run yet.";
  if (state.kind === "valid") return `Evidence ready. ${state.incident.finding.headline}`;
  if (state.kind === "pending") {
    const latest = state.progress.at(-1);
    return latest
      ? `Analysis progress. ${latest.label}: ${latest.status}.`
      : "Investigation submitted.";
  }
  return state.message;
}

function WorkspaceIntro({ state, reconnecting, showWorkflow }: Readonly<{
  state: InvestigationMessageState;
  reconnecting: boolean;
  showWorkflow: boolean;
}>) {
  return (
    <div className="chat-heading">
      <p className="demo-label">Guided demo</p>
      <h1 id="conversation-title">Investigate a metric movement</h1>
      <p>For on-call engineers and service owners investigating a production KPI after an alert.</p>
      <dl className="context-list">
        <div><dt>Workspace</dt><dd>Sample checkout incident</dd></div>
        <div><dt>Service</dt><dd>Checkout</dd></div>
        <div><dt>Metric</dt><dd>Conversion</dd></div>
        <div><dt>Data</dt><dd>Seeded ClickHouse</dd></div>
        <div><dt>Timezone</dt><dd>UTC</dd></div>
        <div><dt>State</dt><dd>{stateLabel(state, reconnecting)}</dd></div>
      </dl>
      {showWorkflow ? (
        <section aria-labelledby="workflow-title" className="workflow-overview">
          <h2 id="workflow-title">How DeployLens works</h2>
          <ol className="workflow-steps">
            <li>Ask why checkout conversion moved.</li>
            <li>Compare the baseline, funnel, deployments, and segments.</li>
            <li>Verify and narrow the finding, then decide whether to roll back or escalate.</li>
          </ol>
        </section>
      ) : null}
    </div>
  );
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
    <div className={`conversation${messages.length === 0 && state.progress.length === 0 && !failure ? " conversation-empty" : ""}`}>
      <div aria-live="polite" aria-relevant="additions text" role="log">
        <ol className="message-log">
          {messages.map((message) => message.parts.map((part, index) => part.type === "text" ? (
            <li className={`message message-${message.role === "user" ? "user" : "system"}`} key={`${message.id}-${index}`}>
              <span>{message.role === "user" ? "You" : "DeployLens"}</span>
              <p>{part.text}</p>
            </li>
          ) : null))}
        </ol>
      </div>
      {state.progress.length > 0 ? (
        <div aria-label="Analysis progress" className="message message-system progress-message" role="region">
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
        <div className="message message-system">
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

function Composer({ initialQuestion, busy, onSubmit, sample, suggestedQuestion }: Readonly<{
  initialQuestion: string;
  busy: boolean;
  onSubmit: (question: string) => string | undefined;
  sample: boolean;
  suggestedQuestion?: string;
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

  function runSuggestion() {
    if (!suggestedQuestion) return;
    setDraft(suggestedQuestion);
    setError(null);
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
        rows={2}
        value={draft}
      />
      <p className="composer-help" id="question-help">
        Guided scope: the seeded checkout question above, followed by a mobile refinement.
      </p>
      {error ? <p className="composer-error" id="question-error" role="alert">{error}</p> : null}
      {suggestedQuestion ? (
        <div className="follow-up-action">
          <span>Next supported step</span>
          <button className="view-reset" disabled={busy} onClick={runSuggestion} type="button">
            {suggestedQuestion}
          </button>
        </div>
      ) : null}
      <button className="primary-button" disabled={busy} type="submit">
        {busy
          ? "Investigating…"
          : sample && draft.trim() === initialQuestion
            ? "Run sample investigation"
            : "Investigate"}
      </button>
    </form>
  );
}

function EvidenceStatus({ reconnecting, state }: Readonly<{
  reconnecting: boolean;
  state: InvestigationMessageState;
}>) {
  const failed = state.kind === "schema-invalid" || state.kind === "tool-error";
  const title = reconnecting && state.kind === "pending"
    ? "Reconnecting to this investigation"
    : state.kind === "unsupported"
      ? "This question is outside the demo scope"
      : failed
        ? "No live incident result was produced"
        : "Building the incident evidence";

  return (
    <section className="evidence-pane evidence-status">
      <p className="eyebrow">Live evidence</p>
      <h2>{title}</h2>
      <p>{reconnecting && state.kind === "pending"
        ? "The active Trigger.dev session is being restored. Evidence will appear only after validation."
        : state.kind === "unsupported"
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
        persistResume(chatId, null);
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
  const reconnecting = Boolean(restoredResume) &&
    messageState.kind === "pending" &&
    messageState.progress.length === 0;
  const suggestedQuestion = messageState.kind === "valid" &&
    classifyInvestigationQuestion(messageState.incident.question)?.device !== "mobile"
    ? mobileFollowUp
    : undefined;

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
        <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          {statusAnnouncement(messageState, reconnecting)}
        </p>
        <WorkspaceIntro
          reconnecting={reconnecting}
          showWorkflow={messageState.kind === "initial"}
          state={messageState}
        />
        <Conversation busy={busy} messages={messages} onRetry={retry} state={messageState} />
        <Composer
          busy={busy}
          initialQuestion={incident.question}
          onSubmit={investigate}
          sample={messageState.kind === "initial"}
          {...(suggestedQuestion ? { suggestedQuestion } : {})}
        />
      </aside>
      <div aria-busy={busy} className="evidence-workspace">
        {currentIncident ? (
          <ActiveIncidentEvidence
            incident={currentIncident}
            key={`${currentIncident.incidentId}:${currentIncident.generatedAt}:${currentIncident.defaultViewId}`}
            preview={messageState.kind === "initial"}
          />
        ) : (
          <EvidenceStatus reconnecting={reconnecting} state={messageState} />
        )}
      </div>
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
