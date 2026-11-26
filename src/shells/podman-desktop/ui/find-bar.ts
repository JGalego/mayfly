import { matchesOf, replacedAll } from "./find.ts";

export interface FindParts {
  readonly field: HTMLTextAreaElement;
  readonly bar: HTMLElement;
  readonly find: HTMLInputElement;
  readonly count: HTMLElement;
  readonly previous: HTMLElement;
  readonly next: HTMLElement;
  readonly replace: HTMLInputElement;
  readonly replaceOne: HTMLElement;
  readonly replaceAll: HTMLElement;
  readonly close: HTMLElement;
}

/**
 * Find and replace for the code editor. Ctrl+F or Cmd+F opens it on what is selected; Enter and Shift+Enter go to the next and previous
 * match; Esc goes back to the code. Replacing is typed in, so Ctrl+Z takes it back.
 */
export function findBar({ field, bar, find, count, previous, next, replace, replaceOne, replaceAll, close }: FindParts): void {
  let found: number[] = [];
  let current = -1;
  // Shows the match, selected, in the middle of the editor.
  const show = (): void => {
    count.textContent = find.value === "" ? "" : found.length === 0 ? "No matches" : `${current + 1} of ${found.length}`;
    const at = found[current];
    if (at === undefined) return;
    field.setSelectionRange(at, at + find.value.length);
    const line = field.value.slice(0, at).split("\n").length - 1;
    field.scrollTop = line * Number.parseFloat(getComputedStyle(field).lineHeight) - field.clientHeight / 2;
  };
  const search = (from = field.selectionStart): void => {
    found = matchesOf(field.value, find.value);
    const after = found.findIndex((at) => at >= from);
    current = found.length === 0 ? -1 : after === -1 ? 0 : after;
    show();
  };
  const step = (by: number): void => {
    if (found.length === 0) return;
    current = (current + by + found.length) % found.length;
    show();
  };
  // Typed in, rather than set, so Ctrl+Z takes it back.
  const typeIn = (from: number, to: number, text: string): void => {
    field.focus();
    field.setSelectionRange(from, to);
    document.execCommand("insertText", false, text);
  };
  const open = (): void => {
    const selected = field.value.slice(field.selectionStart, field.selectionEnd);
    if (selected !== "" && !selected.includes("\n")) find.value = selected;
    bar.hidden = false;
    find.focus();
    find.select();
    search(field.selectionStart);
  };
  const shut = (): void => {
    bar.hidden = true;
    field.focus();
  };
  field.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      open();
    }
  });
  field.addEventListener("input", () => !bar.hidden && search(field.selectionStart));
  find.addEventListener("input", () => search(Math.max(0, field.selectionStart)));
  find.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      shut();
    }
  });
  replace.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    shut();
  });
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  replaceOne.addEventListener("click", () => {
    const at = found[current];
    if (at === undefined) return;
    typeIn(at, at + find.value.length, replace.value);
    search(at + replace.value.length);
    replace.focus();
  });
  replaceAll.addEventListener("click", () => {
    if (found.length === 0) return;
    typeIn(0, field.value.length, replacedAll(field.value, find.value, replace.value));
    search(0);
    replace.focus();
  });
  close.addEventListener("click", shut);
}
