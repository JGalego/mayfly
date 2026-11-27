import type { Check, Outcome } from "../doctor.ts";
import { h, keepTime } from "./dom.ts";

const MARK: Record<Outcome | "skip", string> = { pass: "✓", warn: "!", fail: "✗", skip: "–" };

/** Each check, with what to do about it, or a spinner while it runs. */
export function doctorView(checks: readonly Check[] | undefined): HTMLLIElement[] {
  if (checks === undefined) return [h("li", "quiet", "Checking…")];
  return checks.map(({ name, status, detail }) => {
    const mark = status === "checking" ? keepTime(h("span", "finding-mark spinner")) : findingMark(status);
    return h("li", `finding ${status}`, mark, h("div", "", h("p", "finding-name", name), h("p", "quiet", status === "checking" ? "Checking…" : detail)));
  });
}

/** A check's outcome as a round mark: a tick, an exclamation mark, a cross or a dash on green, amber, red or grey. */
export function findingMark(status: Outcome | "skip"): HTMLElement {
  return h("span", "finding-mark", MARK[status]);
}
