import { h } from "./dom.ts";

// Long enough to type it on a phone, and no longer on screen than that.
export const PASSWORD_SHOWN_MS = 30_000;

/** A passphrase, its hyphens set apart so they're typed too, over a bar that drains until it hides. */
export function passwordCard(password: string): HTMLElement[] {
  // A long passphrase wraps after a hyphen, never inside a word, so each word reads whole.
  const words = password.split("-").flatMap((word, index) => (index === 0 ? [word] : [h("span", "password-hyphen", "-"), document.createElement("wbr"), word]));
  const timer = h("span", "password-timer");
  timer.setAttribute("aria-hidden", "true");
  timer.style.animationDuration = `${PASSWORD_SHOWN_MS}ms`;
  return [h("p", "password-words", ...words), timer];
}
