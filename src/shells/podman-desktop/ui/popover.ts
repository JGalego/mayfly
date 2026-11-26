/** Lets a button show and hide its popover: the button toggles it, and Escape or a click anywhere else closes it. */
export function popover(button: HTMLElement, panel: HTMLElement): void {
  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => setOpen(panel.hidden === true));
  document.addEventListener("keydown", (event) => event.key === "Escape" && setOpen(false));
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!panel.contains(target) && !button.contains(target)) setOpen(false);
  });
}
