/** Makes a textarea as tall as its text, from one line up to its CSS max-height, then it scrolls. Returns what to call after changing its text in code. */
export function growWithText(field: HTMLTextAreaElement): () => void {
  const fit = (): void => {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };
  field.addEventListener("input", fit);
  return fit;
}
