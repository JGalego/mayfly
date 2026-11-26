const OPEN = "<think>";
const CLOSE = "</think>";

/** Part of a streamed reply: what the model thought, and what it said. */
export interface Parts {
  readonly thinking: string;
  readonly text: string;
}

export interface ThinkTags {
  read(piece: string): Parts;
  /** Whatever was held back, once the reply has ended. */
  end(): Parts;
}

const NOTHING: Parts = { thinking: "", text: "" };

/**
 * Splits a streamed reply that opens with the model's thinking between <think> tags, as some servers send it, from the reply itself.
 * A tag can arrive split across pieces, so text that may be the start of one waits for the next piece.
 */
export function thinkTags(): ThinkTags {
  let mode: "opening" | "thinking" | "replying" = "opening";
  let held = "";
  const take = (length: number): string => {
    const taken = held.slice(0, length);
    held = held.slice(length);
    return taken;
  };
  return {
    read(piece) {
      held += piece;
      if (mode === "opening") {
        const lead = held.trimStart();
        if (OPEN.startsWith(lead)) return NOTHING;
        mode = lead.startsWith(OPEN) ? "thinking" : "replying";
        if (mode === "thinking") held = lead.slice(OPEN.length);
      }
      if (mode === "replying") return { thinking: "", text: take(held.length) };
      const close = held.indexOf(CLOSE);
      if (close === -1) return { thinking: take(held.length - partialClose(held)), text: "" };
      const thinking = take(close);
      held = held.slice(CLOSE.length);
      mode = "replying";
      return { thinking, text: take(held.length) };
    },
    end() {
      const rest = take(held.length);
      return mode === "thinking" ? { thinking: rest, text: "" } : { thinking: "", text: rest };
    },
  };
}

/** How many of the text's last characters could begin the closing tag. */
function partialClose(text: string): number {
  for (let length = Math.min(CLOSE.length - 1, text.length); length > 0; length--) {
    if (CLOSE.startsWith(text.slice(-length))) return length;
  }
  return 0;
}
