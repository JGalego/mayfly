/**
 * A tablist as the keyboard expects it: only the chosen tab is in the Tab order, and the arrow keys, Home and End move between the tabs,
 * choosing each as they reach it.
 */
export function keyboardTabs(list: HTMLElement): void {
  list.addEventListener("keydown", (event) => {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((tab) => !tab.hidden && !tab.disabled);
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const last = tabs.length - 1;
    const to = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (at === -1 || to === undefined) return;
    event.preventDefault();
    // Chosen first, as choosing a tab may move the focus elsewhere, then focused.
    tabs[to]?.click();
    tabs[to]?.focus();
  });
}

/** Marks the chosen tab, and keeps only it in the Tab order. */
export function chooseTab(tab: HTMLElement, chosen: boolean): void {
  tab.setAttribute("aria-selected", String(chosen));
  tab.tabIndex = chosen ? 0 : -1;
}
