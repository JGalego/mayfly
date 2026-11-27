import { leadingCommand } from "./commands.ts";
import { h } from "./dom.ts";

/** Sets a command at the start of a textarea apart, on a copy behind it, since a textarea can't style part of its text. Returns what to call after changing the field's text in code. */
export function markCommands(field: HTMLTextAreaElement, backdrop: HTMLElement): () => void {
  const follow = (): void => backdrop.style.setProperty("--scrolled", `${-field.scrollTop}px`);
  const mark = (): void => {
    const typed = leadingCommand(field.value);
    backdrop.replaceChildren(...(typed === undefined ? [] : [h("span", "typed-command", typed.command)]));
    follow();
  };
  field.addEventListener("input", mark);
  field.addEventListener("scroll", follow);
  return mark;
}
