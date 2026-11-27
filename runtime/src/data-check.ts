// Run by the trial in the app's container: does every stored record fit the kinds this version declares? It prints a report.
import { importApp } from "./generated-app.ts";
import { checkStore, DATA_FILE } from "./store.ts";

// The app's code may write to the console as it loads. The report is the line after.
console.log = console.info = console.warn = console.error = console.debug = () => {};
const { kinds } = await importApp();
process.stdout.write(`\n${JSON.stringify(checkStore(DATA_FILE, kinds))}\n`);
// The app's code may have started timers, which would keep Node running.
process.exit(0);
