import type { AppView } from "../../../engine/engine.ts";
import type { Backup } from "../../../engine/state.ts";
import { nameChip } from "./chips.ts";
import { h } from "./dom.ts";
import { when } from "./format.ts";
import { icon } from "./icons.ts";

const CONFIRM_MS = 4000;

export interface DataActions {
  readonly exportData: () => void;
  readonly restore: (id: string) => void;
  /** Draws the tab again, as arming a button changes it. */
  readonly redraw: () => void;
}

// The backup whose Restore was clicked once, waiting for the second click that puts it back.
let armed: { readonly id: string; readonly timer: number } | undefined;

/** The Data tab: saving the app's records to a file, and the backups that put them back, newest first. Restoring waits for other work. */
export function dataView(app: AppView, idle: boolean, actions: DataActions): Node[] {
  const save = h("button", "quiet-button with-icon", icon("file"), "Export");
  save.type = "button";
  save.setAttribute("aria-label", `Save the data of ${app.name} as JSON`);
  save.addEventListener("click", actions.exportData);
  const backups = app.backups.toReversed();
  const list = backups.length === 0 ? h("p", "quiet", "Backups show here once a new version runs") : h("ul", "backup-list", ...backups.map((backup) => backupCard(backup, idle, actions)));
  return [h("div", "data-head", h("p", "quiet", "Restoring a backup loses the changes made since"), save), list];
}

function backupCard(backup: Backup, idle: boolean, actions: DataActions): HTMLElement {
  const waiting = armed?.id === backup.id;
  const restore = h("button", waiting ? "quiet-button armed" : "quiet-button", waiting ? "Confirm restore" : "Restore");
  restore.type = "button";
  restore.disabled = !idle;
  restore.addEventListener("click", () => {
    disarm();
    if (waiting) actions.restore(backup.id);
    else armed = { id: backup.id, timer: window.setTimeout(() => (disarm(), actions.redraw()), CONFIRM_MS) };
    actions.redraw();
  });
  const facts = h("div", "backup-facts", h("span", "", nameChip(backup.id), " ", when(backup.at)), h("span", "quiet", ...before(backup)));
  return h("li", "backup-card", facts, restore);
}

function before({ before: next }: Backup): (Node | string)[] {
  return "version" in next ? ["From before version ", nameChip(next.version)] : ["From before restoring ", nameChip(next.restore)];
}

function disarm(): void {
  if (armed !== undefined) window.clearTimeout(armed.timer);
  armed = undefined;
}
