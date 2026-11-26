import { highlightInto } from "./code.ts";

/**
 * Turns a textarea into a small code editor and gives back how to load code into it.
 * The textarea keeps the typing, the caret and the selection, and a highlighted copy of its text shows through it from underneath.
 */
export function codeEditor(field: HTMLTextAreaElement, shadow: HTMLElement): (code: string) => void {
  const paint = (): void => highlightInto(shadow, field.value);
  field.addEventListener("input", paint);
  field.addEventListener("scroll", () => shadow.scrollTo(field.scrollLeft, field.scrollTop));
  field.addEventListener("keydown", (event) => {
    // A code editor indents with Tab rather than leaving the field.
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    field.setRangeText("  ", field.selectionStart, field.selectionEnd, "end");
    paint();
  });
  return (code) => {
    field.value = code;
    field.setSelectionRange(0, 0);
    paint();
    field.focus();
    field.scrollTo(0, 0);
  };
}
