import type { Suggestion } from "./commands.ts";
import { h } from "./dom.ts";

/**
 * Shows suggestions over the composer as the person types. Arrows move through them, Enter or Tab puts the chosen one in the
 * field, and Escape closes them. While they show, Enter picks rather than sends.
 */
export function commandMenu(field: HTMLTextAreaElement, menu: HTMLElement, suggest: (text: string) => Suggestion[]): void {
  let shown: Suggestion[] = [];
  let chosen = 0;
  const draw = (): void => {
    menu.replaceChildren(...shown.map((suggestion, at) => item(suggestion, at, at === chosen, () => accept(at))));
    menu.hidden = shown.length === 0;
    field.setAttribute("aria-expanded", String(!menu.hidden));
    if (menu.hidden) field.removeAttribute("aria-activedescendant");
    else field.setAttribute("aria-activedescendant", `command-${chosen}`);
  };
  const update = (): void => {
    shown = suggest(field.value);
    chosen = 0;
    draw();
  };
  const accept = (at: number): void => {
    const picked = shown[at];
    if (picked === undefined) return;
    field.value = picked.fill;
    field.setSelectionRange(field.value.length, field.value.length);
    field.focus();
    update();
  };
  const close = (): void => {
    shown = [];
    draw();
  };
  field.addEventListener("input", update);
  field.addEventListener("focus", update);
  field.addEventListener("blur", close);
  // Before the composer's own Enter, which sends.
  field.addEventListener(
    "keydown",
    (event) => {
      if (menu.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        chosen = (chosen + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
        draw();
      } else if (event.key === "Enter" || event.key === "Tab") accept(chosen);
      else if (event.key === "Escape") close();
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
}

function item({ label, detail }: Suggestion, at: number, chosen: boolean, pick: () => void): HTMLLIElement {
  const line = h("li", chosen ? "chosen" : "", h("span", "command-label", label), h("span", "command-detail", detail));
  line.id = `command-${at}`;
  line.setAttribute("role", "option");
  line.setAttribute("aria-selected", String(chosen));
  // Picked on press, before the field loses its focus and closes the menu.
  line.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pick();
  });
  return line;
}
