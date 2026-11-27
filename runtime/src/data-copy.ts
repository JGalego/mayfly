// Copies an app's store from one data folder to another, for a trial or a rename: `data-copy.ts <from> <to>`. It runs none of the app's code.
import { basename, join } from "node:path";
import { copyStore, DATA_FILE } from "./store.ts";

const [from, to] = process.argv.slice(2);
if (from === undefined || to === undefined) throw new Error("Usage: data-copy.ts <from> <to>");
copyStore(join(from, basename(DATA_FILE)), join(to, basename(DATA_FILE)));
