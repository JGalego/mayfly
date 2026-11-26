import { kindOf, problemWithFiles } from "../../../engine/attachments.ts";
import type { Upload } from "../messages.ts";
import { h } from "./dom.ts";
import { icon } from "./icons.ts";

export interface UploadParts {
  readonly input: HTMLInputElement;
  readonly button: HTMLElement;
  readonly list: HTMLElement;
  /** Where files can be dropped, and pasted. */
  readonly composer: HTMLElement;
}

/** The files waiting to go with the next request. */
export interface Uploads {
  /** Takes the files, leaving none waiting. */
  take(): Upload[];
  /** Puts files back, as when a request fails. */
  put(files: readonly Upload[]): void;
}

/** Attaching files in the composer: from its button, by pasting or by dropping them. Mayfly's own rules say which files it takes. */
export function uploads({ input, button, list, composer }: UploadParts, refuse: (why: string) => void): Uploads {
  let waiting: Upload[] = [];
  const draw = (): void => {
    list.replaceChildren(...waiting.map((file, at) => chip(file, () => remove(at))));
    list.hidden = waiting.length === 0;
  };
  const remove = (at: number): void => {
    waiting = waiting.filter((_, index) => index !== at);
    draw();
  };
  const add = async (files: readonly File[]): Promise<void> => {
    const read = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) })));
    const decoded = [...waiting.map(decode), ...read];
    const problem = problemWithFiles(decoded);
    if (problem !== undefined) return refuse(problem);
    waiting = [...waiting, ...read.map(({ name, type, data }) => ({ name, type, data: toBase64(data) }))];
    draw();
  };
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    void add([...(input.files ?? [])]);
    input.value = "";
  });
  composer.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    void add(files);
  });
  composer.addEventListener("dragover", (event) => event.preventDefault());
  composer.addEventListener("drop", (event) => {
    event.preventDefault();
    void add([...(event.dataTransfer?.files ?? [])]);
  });
  return {
    take() {
      const taken = waiting;
      waiting = [];
      draw();
      return taken;
    },
    put(files) {
      waiting = [...files];
      draw();
    },
  };
}

/** A file waiting in the composer, or kept in a conversation: a thumbnail for an image, a name and size for a text file. */
function chip(file: Upload, remove: () => void): HTMLLIElement {
  const close = h("button", "quiet-button", icon("close"));
  close.type = "button";
  close.setAttribute("aria-label", `Remove ${file.name}`);
  close.addEventListener("click", remove);
  return h("li", "file-chip", ...fileLook(file.name, file.type, base64Bytes(file.data), kindOf(file) === "image" ? imageUrl(file.type, file.data) : undefined), close);
}

/** How a file shows: an image's thumbnail, or a text file's icon, with its name and size. */
export function fileLook(name: string, type: string, bytes: number, url: string | undefined): Node[] {
  const picture = url === undefined ? icon("file") : thumbnail(url, name);
  return [picture, h("span", "file-name", name), h("span", "quiet", sizeOf(bytes))];
}

/** An image sent in a conversation: the picture alone, with its name and size on hover. */
export function sentImage(name: string, bytes: number, url: string): HTMLLIElement {
  const shown = h("li", "file-image", thumbnail(url, name));
  shown.title = `${name} · ${sizeOf(bytes)}`;
  return shown;
}

function thumbnail(url: string, name: string): HTMLImageElement {
  const image = h("img", "thumbnail");
  image.src = url;
  image.alt = name;
  return image;
}

/** An image to show from its contents. Made here as a blob, which the page's policy allows, unlike a data URL. */
export function imageUrl(type: string, base64: string): string {
  return URL.createObjectURL(new Blob([fromBase64(base64)], { type }));
}

function sizeOf(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function decode({ name, type, data }: Upload): { name: string; type: string; data: Uint8Array } {
  return { name, type, data: fromBase64(data) };
}

function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  // In pieces, as spreading a large array into one call overflows the stack.
  for (let at = 0; at < data.length; at += 0x8000) binary += String.fromCharCode(...data.subarray(at, at + 0x8000));
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
