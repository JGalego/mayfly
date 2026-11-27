import { kindOf, MAX_IMAGE } from "../../../engine/attachments.ts";

// Below 1, so a photo redrawn once usually fits.
const MARGIN = 0.9;
const QUALITY = 0.85;
const TRIES = 3;

/** Whether a file has to be drawn again to go: an image too big for Mayfly, or of a kind the model can't see, such as HEIC. */
export function needsRedrawing(file: { readonly name: string; readonly type: string; readonly size: number }): boolean {
  if (!file.type.startsWith("image/")) return false;
  return file.size > MAX_IMAGE || kindOf(file) !== "image";
}

/** How much to shrink each side of an image this big so it fits. */
export function shrinkFor(bytes: number): number {
  return bytes <= MAX_IMAGE ? 1 : Math.sqrt(MAX_IMAGE / bytes) * MARGIN;
}

/** The photo as Mayfly takes it: as it is when it can, or else drawn again as a JPEG small enough to go. */
export async function fitPhoto(file: File): Promise<File> {
  if (!needsRedrawing(file)) return file;
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, shrinkFor(file.size));
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const jpeg = await drawn(bitmap, scale);
    if (jpeg.size <= MAX_IMAGE) return new File([jpeg], `${file.name.replace(/\.[^.]*$/, "")}.jpg`, { type: "image/jpeg" });
    scale *= shrinkFor(jpeg.size);
  }
  // Still too big: Mayfly's own check says so.
  return file;
}

function drawn(bitmap: ImageBitmap, scale: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error("The phone couldn't redraw the photo.")) : resolve(blob)), "image/jpeg", QUALITY));
}
