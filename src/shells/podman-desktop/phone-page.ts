import { onPhone } from "../../core/phone.ts";
import type { AppView } from "../../engine/engine.ts";
import type { FromUi, Progress, ToUi } from "./messages.ts";

/** An app as the phone sees it: at its phone address, without who it's shared with, its versions or what it spent. */
export type PhoneApp = Pick<AppView, "name" | "starred" | "head" | "conversation"> & { readonly url: string };

type Heard = Extract<ToUi, { readonly type: "progress" | "created" | "renamed" | "attachment" | "health" | "notice" | "error" }>;

/** What the phone page hears. */
export type ToPhone = { readonly type: "state"; readonly apps: readonly PhoneApp[]; readonly working: Progress | null } | Heard;

// Making apps, changing them and following along. Never a secret, a setting, or taking anything away: a lost phone can do no more.
const ASKS: ReadonlySet<FromUi["type"]> = new Set(["ready", "send", "ask", "fix", "retry", "undo", "start", "attachment", "health"]);
const HEARS: ReadonlySet<ToUi["type"]> = new Set(["progress", "created", "renamed", "attachment", "health", "notice", "error"]);

export function phoneMayAsk(message: FromUi): boolean {
  // Choosing a model stays with the computer, as /model does.
  if (message.type === "send" && message.model !== undefined) return false;
  return ASKS.has(message.type);
}

/** What the phone hears of a message to the pages, or null for nothing. */
export function forPhone(message: ToUi): ToPhone | null {
  if (message.type === "progress") return { type: "progress", working: phoneWork(message.working) };
  if (message.type !== "state") return heard(message) ? message : null;
  const host = message.phoneHost;
  if (host === null) return null;
  return { type: "state", apps: message.apps.map((app) => phoneApp(app, host)), working: message.working === null ? null : phoneWork(message.working) };
}

// The model's code and thinking are for developers. The phone sees the stages, and an answer as it's written.
function phoneWork(work: Progress): Progress {
  return { ...work, steps: work.steps.filter((step) => step.kind !== "thinking" && (step.kind !== "draft" || work.kind === "ask")) };
}

function heard(message: ToUi): message is Heard {
  return HEARS.has(message.type);
}

function phoneApp({ name, url, starred, head, conversation }: AppView, host: string): PhoneApp {
  return { name, url: onPhone(url, host), starred, head, conversation };
}
