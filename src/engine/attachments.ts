/** A file the person sent with a request, as the conversation keeps it. Its contents are stored apart, under the hash that is its id. */
export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly bytes: number;
}

/** A file on its way in, or loaded back: its name, type and contents. */
export interface FileData {
  readonly name: string;
  readonly type: string;
  readonly data: Uint8Array;
}

// Images a model can see, by type. SVG is left out: it is code, not a picture.
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Text files, by their name's ending, as browsers often give them no type.
const TEXTS = new Set([".txt", ".md", ".csv", ".tsv", ".json"]);
const MAX_FILES = 4;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_TEXT = 100 * 1024;

/** Whether a file is an image the model can see, text it can read, or neither. */
export function kindOf({ name, type }: { readonly name: string; readonly type: string }): "image" | "text" | undefined {
  if (IMAGES.has(type)) return "image";
  const dot = name.lastIndexOf(".");
  return dot !== -1 && TEXTS.has(name.slice(dot).toLowerCase()) ? "text" : undefined;
}

/** Why these files cannot go with a request, or undefined when they can. */
export function problemWithFiles(files: readonly FileData[]): string | undefined {
  if (files.length > MAX_FILES) return `Attach at most ${MAX_FILES} files.`;
  for (const file of files) {
    const kind = kindOf(file);
    if (kind === undefined) return `Mayfly takes images (PNG, JPEG, WebP, GIF) and text files (.txt, .md, .csv, .tsv, .json), not ${file.name}.`;
    if (kind === "image" && file.data.length > MAX_IMAGE) return `${file.name} is larger than 5 MB.`;
    if (kind === "text" && file.data.length > MAX_TEXT) return `${file.name} is larger than 100 KB.`;
    if (kind === "text" && textOf(file) === undefined) return `${file.name} is not text.`;
  }
  return undefined;
}

/** A text file's contents, or undefined when they are not UTF-8. */
export function textOf({ data }: FileData): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
}
