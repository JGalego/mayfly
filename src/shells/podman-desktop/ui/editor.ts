import { highlightInto } from "./code.ts";
import { h } from "./dom.ts";
import { lineMarks } from "./gutter.ts";
import { indent } from "./indent.ts";

export interface EditorParts {
  readonly field: HTMLTextAreaElement;
  /** The highlighted copy of the code, under the field. */
  readonly shadow: HTMLElement;
  readonly gutter: HTMLElement;
  /** Told after every change whether the code differs from where the edit started. */
  readonly changed: (changed: boolean) => void;
}

export interface CodeEditor {
  /** Starts editing this code. */
  load(code: string): void;
  /** The code the edit started from, and the code now. */
  edit(): { readonly before: string; readonly after: string };
  /** Takes the code now as the code the edit starts from, once it is saved. */
  saved(): void;
}

/**
 * Turns a textarea into a small code editor.
 * The textarea keeps the typing, the caret and the selection. A highlighted copy of its text shows through it from underneath,
 * and the gutter numbers the lines and marks those added, changed or removed since the edit started.
 */
export function codeEditor({ field, shadow, gutter, changed }: EditorParts): CodeEditor {
  let before = "";
  const paint = (): void => {
    highlightInto(shadow, field.value);
    gutter.replaceChildren(...lineMarks(before, field.value).map((mark, line) => h("span", mark ?? "", String(line + 1))));
    changed(field.value !== before);
  };
  field.addEventListener("input", paint);
  field.addEventListener("scroll", () => {
    shadow.scrollTo(field.scrollLeft, field.scrollTop);
    gutter.scrollTop = field.scrollTop;
  });
  // A code editor indents with Tab and outdents with Shift+Tab. Esc, then Tab, leaves it, for whoever moves by keyboard.
  let leaving = false;
  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return void (leaving = true);
    if (event.key !== "Tab" || leaving) return void (leaving = false);
    event.preventDefault();
    const change = indent(field.value, field.selectionStart, field.selectionEnd, event.shiftKey);
    if (field.value.slice(change.from, change.to) === change.text) return;
    field.setSelectionRange(change.from, change.to);
    // Typed in, unlike setRangeText, so Ctrl+Z takes it back. It paints, as typing does.
    document.execCommand("insertText", false, change.text);
    field.setSelectionRange(change.start, change.end);
  });
  return {
    load(code) {
      before = code;
      field.value = code;
      field.setSelectionRange(0, 0);
      paint();
      field.focus();
      field.scrollTo(0, 0);
    },
    edit: () => ({ before, after: field.value }),
    saved() {
      before = field.value;
      paint();
    },
  };
}
