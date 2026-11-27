/** A kind of record an app keeps: every key that starts with its prefix, and the fields its records have. */
export interface Kind {
  readonly prefix: string;
  readonly fields: ReadonlyMap<string, Field>;
}

/** A field's type as declared, such as `string[]?`: a JSON type, or a list of one, and `?` when it may be missing or null. */
interface Field {
  readonly declared: string;
  readonly type: Scalar;
  readonly list: boolean;
  readonly optional: boolean;
}

type Scalar = "string" | "number" | "boolean";

/** A declared field that a record lacks or holds as another type. Never its value, which is people's data. */
export interface Misfit {
  readonly field: string;
  readonly expected: string;
  /** "missing", or the type it holds, such as "number" or "string[]". */
  readonly found: string;
}

// One colon, at the end, so no prefix is the start of another and a key has one kind at most.
const PREFIX = /^[a-z][a-z0-9-]*:$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;
const TYPE = /^(string|number|boolean)(\[\])?(\?)?$/;

/** The kinds an app declares in `export const records`, or why the declaration can't be used. */
export function kindsFrom(records: unknown): Kind[] {
  if (!isObject(records)) throw new Error("`records` must be an object of kinds by key prefix");
  return Object.entries(records).map(([prefix, fields]) => kindFrom(prefix, fields));
}

function kindFrom(prefix: string, fields: unknown): Kind {
  if (!PREFIX.test(prefix)) throw new Error(`\`${prefix}\` must be a prefix of lowercase letters, digits and hyphens ending in a colon, such as \`task:\``);
  if (!isObject(fields)) throw new Error(`\`${prefix}\` must be an object of fields and their types`);
  return { prefix, fields: new Map(Object.entries(fields).map(([name, declared]) => [name, fieldFrom(prefix, name, declared)])) };
}

function fieldFrom(prefix: string, name: string, declared: unknown): Field {
  if (!FIELD.test(name)) throw new Error(`\`${prefix}\` can't have a field called \`${name}\`: use letters, digits and underscores, starting with a letter`);
  const parts = typeof declared === "string" ? TYPE.exec(declared) : null;
  if (parts === null) throw new Error(`\`${name}\` of \`${prefix}\` is \`${String(declared)}\`, which isn't string, number or boolean, a list of one such as \`string[]\`, or any of these with \`?\``);
  return { declared: parts[0], type: parts[1] as Scalar, list: parts[2] !== undefined, optional: parts[3] !== undefined };
}

/** The kind a key belongs to: the one whose prefix it starts with, followed by the record's own id. */
export function kindFor(kinds: readonly Kind[], key: string): Kind | undefined {
  const end = key.indexOf(":") + 1;
  if (end === 0 || end === key.length) return undefined;
  return kinds.find((kind) => kind.prefix === key.slice(0, end));
}

/** The declared fields a record lacks or holds as another type. Fields it isn't declared to have don't matter: a newer version may have written them. */
export function misfitsOf(kind: Kind, record: Readonly<Record<string, unknown>>): Misfit[] {
  return [...kind.fields].flatMap(([field, type]) => {
    const found = typeOf(record[field]);
    return fits(type, record[field]) ? [] : [{ field, expected: type.declared, found }];
  });
}

/** Why the store won't keep a record under a kind, or undefined when it will. */
export function refusal(kind: Kind, record: unknown): string | undefined {
  if (!isObject(record)) return "A record must be an object of fields";
  const undeclared = Object.keys(record).find((field) => !kind.fields.has(field));
  if (undeclared !== undefined) return `\`${kind.prefix}\` records have no field \`${undeclared}\` so declare it in \`records\``;
  const [misfit] = misfitsOf(kind, record);
  if (misfit === undefined) return undefined;
  const has = misfit.found === "missing" ? "has none" : `has ${article(misfit.found)} ${misfit.found}`;
  return `\`${kind.prefix}\` records need \`${misfit.field}\` as ${misfit.expected} but this one ${has}`;
}

function fits({ type, list, optional }: Field, value: unknown): boolean {
  if (value === undefined || value === null) return optional;
  if (!list) return isScalar(type, value);
  return Array.isArray(value) && value.every((item) => isScalar(type, item));
}

function isScalar(type: Scalar, value: unknown): boolean {
  return type === "number" ? Number.isFinite(value) : typeof value === type;
}

function typeOf(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (!Array.isArray(value)) return typeof value;
  const odd = value.find((item) => typeOf(item) !== typeOf(value[0]));
  return odd === undefined ? `${value.length === 0 ? "empty" : typeOf(value[0])}[]` : "mixed[]";
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? "an" : "a";
}

export function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
