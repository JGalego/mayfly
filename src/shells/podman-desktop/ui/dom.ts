// One turn of a spinner, as in ui.css.
const SPIN_MS = 800;

/** Builds an element from text and other elements. Text stays text: nothing in it can become markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  node.append(...children);
  return node;
}

// The page is redrawn as work progresses. Every spinner keeps time with the clock, so a redrawn one
// carries on from where the old one was instead of starting its turn again.
export function keepTime<T extends HTMLElement>(spinning: T): T {
  spinning.style.setProperty("--spin-delay", `-${Math.round(performance.now() % SPIN_MS)}ms`);
  return spinning;
}
