/** Where the text is in the code, whatever its case, each place after the one before. */
export function matchesOf(code: string, text: string): number[] {
  if (text === "") return [];
  const haystack = code.toLowerCase();
  const needle = text.toLowerCase();
  const found: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

/** The code with every match of the text, whatever its case, replaced. */
export function replacedAll(code: string, text: string, by: string): string {
  const found = matchesOf(code, text);
  let result = "";
  let from = 0;
  for (const at of found) {
    result += code.slice(from, at) + by;
    from = at + text.length;
  }
  return result + code.slice(from);
}
