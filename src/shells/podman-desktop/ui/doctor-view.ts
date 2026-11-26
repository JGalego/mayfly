import type { Check } from "../doctor.ts";
import { h } from "./dom.ts";

const MARK: Record<Check["status"], string> = { pass: "✓", warn: "!", fail: "✗" };

/** The doctor's verdict in a sentence, and each check with what to do about it. */
export function doctorView(checks: readonly Check[] | undefined): { verdict: string; items: HTMLLIElement[] } {
  if (checks === undefined) return { verdict: "Checking…", items: [] };
  const failed = checks.filter((check) => check.status === "fail").length;
  const verdict = failed === 0 ? "Yes. Mayfly has everything it needs to make and run apps." : `Not yet: ${failed === 1 ? "one thing needs" : `${failed} things need`} fixing.`;
  const items = checks.map(({ name, status, detail }) => h("li", `finding ${status}`, h("span", "finding-mark", MARK[status]), h("div", "", h("p", "finding-name", name), h("p", "quiet", detail))));
  return { verdict, items };
}
