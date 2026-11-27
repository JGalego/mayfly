export type CommandName = "ask" | "fix" | "retry" | "undo" | "start" | "model" | "rename" | "remove";

/** A command the conversation takes after a slash: what it does, what it takes, and whether it needs an app to act on. */
export interface Command {
  readonly name: CommandName;
  readonly says: string;
  /** What goes after the name, if anything. */
  readonly takes?: string;
  readonly needsApp: boolean;
}

export const COMMANDS: readonly Command[] = [
  { name: "ask", says: "Ask about the app without changing it", takes: "a question", needsApp: true },
  { name: "fix", says: "Fix the errors in the app's logs", needsApp: true },
  { name: "retry", says: "Retry the last request", needsApp: true },
  { name: "undo", says: "Redeploy the previous version", needsApp: true },
  { name: "start", says: "Start the stopped app", needsApp: true },
  { name: "model", says: "Switch models", takes: "a model", needsApp: false },
  { name: "rename", says: "Rename and redeploy the app", takes: "a new name", needsApp: true },
  { name: "remove", says: "Delete the app and its history", needsApp: true },
];

/** What the composer holds: a request for the model, a command and what follows it, or a command Mayfly does not know. */
export type Typed =
  | { readonly kind: "request"; readonly text: string }
  | { readonly kind: "command"; readonly command: Command; readonly argument: string }
  | { readonly kind: "unknown"; readonly name: string };

/** One line of the menu: what it shows, what picking it puts in the composer, and whether that leaves nothing more to type. */
export interface Suggestion {
  readonly label: string;
  readonly detail: string;
  readonly fill: string;
  readonly final: boolean;
}

const COMMAND = /^\/(\S*)\s*([\s\S]*)$/;
const MODEL_ARGUMENT = /^\/model\s+(.*)$/i;

export function parse(text: string): Typed {
  const match = COMMAND.exec(text);
  if (match === null) return { kind: "request", text };
  const name = (match[1] ?? "").toLowerCase();
  const command = COMMANDS.find((known) => known.name === name);
  return command === undefined ? { kind: "unknown", name } : { kind: "command", command, argument: (match[2] ?? "").trim() };
}

/** The commands that start with the name being typed, then for /model, the models that hold what follows it. */
export function suggestions(text: string, context: { readonly app: boolean; readonly models: readonly string[] }): Suggestion[] {
  const model = MODEL_ARGUMENT.exec(text);
  if (model !== null) {
    const wanted = (model[1] ?? "").trim().toLowerCase();
    const found = context.models.filter((label) => label.toLowerCase().includes(wanted));
    return found.length === 1 && found[0]?.toLowerCase() === wanted ? [] : found.map((label) => ({ label, detail: "", fill: `/model ${label}`, final: true }));
  }
  const typing = /^\/(\S*)$/.exec(text);
  if (typing === null) return [];
  const prefix = (typing[1] ?? "").toLowerCase();
  return COMMANDS.filter((command) => command.name.startsWith(prefix) && (context.app || !command.needsApp)).map((command) => ({
    label: `/${command.name}`,
    detail: command.takes === undefined ? command.says : `${command.says} · ${command.takes}`,
    fill: `/${command.name} `,
    final: command.takes === undefined,
  }));
}
