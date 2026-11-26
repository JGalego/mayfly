export interface ThreadFindParts {
  readonly bar: HTMLElement;
  readonly find: HTMLInputElement;
  readonly count: HTMLElement;
  readonly previous: HTMLElement;
  readonly next: HTMLElement;
  readonly close: HTMLElement;
  /** The conversation's turns, which a redraw replaces. */
  readonly turns: HTMLElement;
}

/** Finding in a conversation: marks every turn that holds the text, and moves between them, starting from the newest. */
export interface ThreadFind {
  open(): void;
  /** Marks the turns again, after a redraw replaced them. */
  mark(): void;
}

export function threadFind({ bar, find, count, previous, next, close, turns }: ThreadFindParts): ThreadFind {
  let current = -1;
  const found = (): HTMLElement[] => {
    const wanted = find.value.trim().toLowerCase();
    if (bar.hidden || wanted === "") return [];
    return [...turns.children].filter((turn): turn is HTMLElement => turn instanceof HTMLElement && (turn.textContent ?? "").toLowerCase().includes(wanted));
  };
  const mark = (): void => {
    const matches = found();
    current = Math.min(current, matches.length - 1);
    for (const turn of turns.children) turn.classList.remove("found", "found-current");
    for (const turn of matches) turn.classList.add("found");
    matches[current]?.classList.add("found-current");
    count.textContent = find.value.trim() === "" ? "" : matches.length === 0 ? "No matches" : `${current + 1} of ${matches.length}`;
  };
  const step = (by: number): void => {
    const matches = found();
    if (matches.length === 0) return;
    current = (current + by + matches.length) % matches.length;
    mark();
    matches[current]?.scrollIntoView({ block: "center" });
  };
  const shut = (): void => {
    bar.hidden = true;
    mark();
  };
  find.addEventListener("input", () => {
    current = found().length - 1;
    step(0);
  });
  find.addEventListener("keydown", (event) => {
    if (event.key === "Enter") step(event.shiftKey ? -1 : 1);
    else if (event.key === "Escape") shut();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  close.addEventListener("click", shut);
  return {
    open() {
      bar.hidden = false;
      find.focus();
      find.select();
      current = found().length - 1;
      step(0);
    },
    mark,
  };
}
