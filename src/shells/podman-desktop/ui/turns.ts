import { kindOf } from "../../../engine/attachments.ts";
import type { Turn } from "../../../engine/state.ts";
import type { Progress } from "../messages.ts";
import { nameChip, withChips } from "./chips.ts";
import { h, keepTime } from "./dom.ts";
import { markdownView, type Opener } from "./markdown-view.ts";
import { progressView, TITLES, type Showing } from "./progress.ts";
import { fileLook, sentImage } from "./uploads.ts";

/** What a page shows a conversation with: where its links open, the thumbnails it has, and Mayfly's logo. */
export interface Speaking {
  readonly open: Opener;
  /** An attached image's thumbnail, or undefined until the page has it. */
  readonly thumbnail: (app: string, id: string) => string | undefined;
  readonly logo: () => string;
}

export function turnItem(said: Turn, speaking: Speaking, extras: readonly Node[] = []): HTMLLIElement {
  const { from, text, at } = said;
  // Mayfly's replies, and its model's, can be Markdown. What a person typed shows as they typed it.
  const failure = said.from === "mayfly" && said.failed === true;
  const words = from === "mayfly" ? h("div", failure ? "md failure" : "md", ...markdownView(text, speaking.open)) : h("p", "", ...withChips(text));
  // When it was said, for anyone who wants to know.
  if (at !== 0) words.title = new Date(at).toLocaleString();
  return turn(from, h("div", "", words, ...extras), speaking);
}

export function turn(from: Turn["from"], body: HTMLElement, speaking: Speaking): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `turn ${from}`;
  if (from === "mayfly") item.append(avatar(speaking.logo()));
  item.append(body);
  return item;
}

/** The files a person attached to a turn: images as thumbnails, once the page has them, and text files by name. */
export function filesOf(app: string, said: Turn, speaking: Speaking): Node[] {
  const files = said.from === "person" ? (said.attachments ?? []) : [];
  if (files.length === 0) return [];
  return [
    h(
      "ul",
      "turn-files",
      ...files.map((file) => {
        const url = kindOf(file) === "image" ? speaking.thumbnail(app, file.id) : undefined;
        return url === undefined ? h("li", "file-chip", ...fileLook(file.name, file.type, file.bytes, undefined)) : sentImage(file.name, file.bytes, url);
      }),
    ),
  ];
}

/** The work under way, as Mayfly's next turn in the conversation: an answer as it is written, or the stages of the work. */
export function pendingView(working: Progress, showing: Showing, speaking: Speaking): HTMLElement {
  if (working.kind === "remove") return h("p", "", spinner(), " Stopping and removing ", nameChip(working.app ?? ""), "…");
  if (working.kind !== "ask") return progressView(working, TITLES[working.kind], showing);
  const draft = working.steps.findLast((step) => step.kind === "draft");
  return draft?.kind === "draft" ? h("div", "md", ...markdownView(draft.text, speaking.open)) : h("p", "", spinner(), " Thinking about your question…");
}

export function spinner(): HTMLSpanElement {
  return keepTime(h("span", "spinner small"));
}

function avatar(logo: string): HTMLImageElement {
  const image = h("img", "avatar");
  image.src = logo;
  image.alt = "";
  return image;
}
