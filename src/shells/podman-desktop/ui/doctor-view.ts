import type { Check } from "../doctor.ts";
import { h } from "./dom.ts";

const MARK: Record<Check["status"], string> = { pass: "✓", warn: "!", fail: "✗" };

/** Each check, with what to do about it. */
export function doctorView(checks: readonly Check[] | undefined): HTMLLIElement[] {
  if (checks === undefined) return [h("li", "quiet", "Checking…")];
  return checks.map(({ name, status, detail }) => h("li", `finding ${status}`, findingMark(status), h("div", "", h("p", "finding-name", name), h("p", "quiet", detail))));
}

/** A check's outcome as a round mark: a tick, an exclamation mark or a cross on green, amber or red. */
export function findingMark(status: Check["status"]): HTMLElement {
  return h("span", "finding-mark", MARK[status]);
}
