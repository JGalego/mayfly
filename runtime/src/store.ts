import { existsSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { kindFor, misfitsOf, refusal, type Kind, type Misfit } from "./records.ts";

/** Where an app's records live: the one writable folder in its container, on a volume of its own. */
export const DATA_FILE = "/data/app.db";

const ONE_MEGABYTE = 1024 * 1024;
const MAX_BYTES = 100 * 1000 * 1000;

type Fields = Readonly<Record<string, unknown>>;

export interface Entry {
  readonly key: string;
  readonly value: Fields;
}

/**
 * Records by key, each checked against its kind. Synchronous: Node runs one request at a time between awaits, so a read and
 * a write with no await between them can't interleave with another request's.
 */
export interface Store {
  get(key: string): Fields | undefined;
  set(key: string, value: Fields): void;
  delete(key: string): void;
  list(prefix: string): Entry[];
}

/** A declared field that some stored records lack or hold as another type, and how many. */
export type CountedMisfit = Misfit & { readonly kind: string; readonly records: number };

/** Whether a version fits the stored data: the kinds it declares, and what doesn't fit them. */
export interface Report {
  readonly kinds: readonly string[];
  readonly misfits: readonly CountedMisfit[];
}

interface Statements {
  readonly get: StatementSync;
  readonly put: StatementSync;
  readonly delete: StatementSync;
  readonly from: StatementSync;
}

/** The store of an app that declares these kinds. The file opens on first use, so an app that keeps nothing needs none. */
export function openStore(file: string, kinds: readonly Kind[]): Store {
  let statements: Statements | undefined;
  const db = (): Statements => (statements ??= open(file));
  const kindOf = (key: string): Kind => {
    const kind = kindFor(kinds, key);
    if (kind === undefined) throw new Error(`\`${key}\` belongs to no kind in \`records\` so declare its prefix there`);
    return kind;
  };
  const stored = (key: string): Fields | undefined => {
    const row = db().get.get(key) as { value: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as Fields);
  };
  return {
    get(key) {
      const kind = kindOf(key);
      const record = stored(key);
      return record === undefined ? undefined : declared(kind, record);
    },
    set(key, value) {
      const kind = kindOf(key);
      const refused = refusal(kind, value);
      if (refused !== undefined) throw new Error(refused);
      const json = JSON.stringify({ ...undeclared(kind, stored(key) ?? {}), ...value });
      if (Buffer.byteLength(json) > ONE_MEGABYTE) throw new Error("A record can be at most 1 MiB");
      db().put.run(key, json);
    },
    delete(key) {
      kindOf(key);
      db().delete.run(key);
    },
    list(prefix) {
      const kind = kinds.find((declaredKind) => prefix.startsWith(declaredKind.prefix));
      if (kind === undefined) throw new Error("List records by a prefix in `records` such as `task:`");
      const entries: Entry[] = [];
      // Keys sort by their bytes, so the keys under a prefix come together, from the prefix itself.
      for (const row of db().from.iterate(prefix) as Iterable<{ key: string; value: string }>) {
        if (!row.key.startsWith(prefix)) break;
        entries.push({ key: row.key, value: declared(kind, JSON.parse(row.value) as Fields) });
      }
      return entries;
    },
  };
}

/** Counts the stored records that don't fit the kinds a version declares. */
export function checkStore(file: string, kinds: readonly Kind[]): Report {
  const counted = new Map<string, CountedMisfit>();
  if (existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    for (const row of db.prepare("SELECT key, value FROM records").iterate() as Iterable<{ key: string; value: string }>) {
      const kind = kindFor(kinds, row.key);
      if (kind === undefined) continue;
      for (const misfit of misfitsOf(kind, JSON.parse(row.value) as Fields)) {
        const id = JSON.stringify([kind.prefix, misfit.field, misfit.found]);
        counted.set(id, { kind: kind.prefix, ...misfit, records: (counted.get(id)?.records ?? 0) + 1 });
      }
    }
    db.close();
  }
  return { kinds: kinds.map((kind) => kind.prefix), misfits: [...counted.values()] };
}

/** Copies a store as it is at this moment, even while the app writes to it. A store never opened copies to nothing. */
export function copyStore(from: string, to: string): void {
  if (!existsSync(from)) return;
  const db = new DatabaseSync(from, { readOnly: true });
  db.prepare("VACUUM INTO ?").run(to);
  db.close();
}

function open(file: string): Statements {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
  // SQLite refuses to grow the file past this, which keeps one app from filling the disk through its store.
  const { page_size: pageSize } = db.prepare("PRAGMA page_size").get() as { page_size: number };
  db.exec(`PRAGMA max_page_count = ${Math.floor(MAX_BYTES / pageSize)}`);
  return {
    get: db.prepare("SELECT value FROM records WHERE key = ?"),
    put: db.prepare("INSERT INTO records (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
    delete: db.prepare("DELETE FROM records WHERE key = ?"),
    from: db.prepare("SELECT key, value FROM records WHERE key >= ? ORDER BY key"),
  };
}

function declared(kind: Kind, record: Fields): Fields {
  return Object.fromEntries(Object.entries(record).filter(([field]) => kind.fields.has(field)));
}

function undeclared(kind: Kind, record: Fields): Fields {
  return Object.fromEntries(Object.entries(record).filter(([field]) => !kind.fields.has(field)));
}
