// Writes every record in an app's data folder to stdout as JSON by key, for the person to save: `data-export.ts <folder>`. It runs none of the app's code.
import { basename, join } from "node:path";
import { DATA_FILE, exportStore } from "./store.ts";

const [folder] = process.argv.slice(2);
if (folder === undefined) throw new Error("Usage: data-export.ts <folder>");
exportStore(join(folder, basename(DATA_FILE)), (chunk) => process.stdout.write(chunk));
