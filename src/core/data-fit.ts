/** A declared field that some stored records lack or hold as another type, as the runtime's check counts them. */
export interface Misfit {
  readonly kind: string;
  readonly field: string;
  /** The type the version declares, such as `string?`. */
  readonly expected: string;
  /** "missing", or the type the records hold, such as `number[]`. Never a value: the records are people's data. */
  readonly found: string;
  readonly records: number;
}

/** What the runtime's check found: the kinds of record a version declares, and the stored ones that don't fit them. */
export interface DataReport {
  readonly kinds: readonly string[];
  readonly misfits: readonly Misfit[];
}

/** Why a version can't run on the data its app keeps, in words for the model, or null when every record fits. */
export function dataProblem({ misfits }: DataReport): string | null {
  if (misfits.length === 0) return null;
  return ["Stored records don't fit this version:", "", ...misfits.map(line)].join("\n");
}

function line({ kind, field, expected, found, records }: Misfit): string {
  const counted = `${records} \`${kind}\` record${records === 1 ? "" : "s"}`;
  if (found === "missing") return `- ${counted} ${records === 1 ? "has" : "have"} no \`${field}\` but this version needs it as \`${expected}\``;
  return `- ${counted} ${records === 1 ? "has" : "have"} \`${field}\` as \`${found}\` but this version needs \`${expected}\``;
}
