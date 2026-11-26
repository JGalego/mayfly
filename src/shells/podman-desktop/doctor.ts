/** One thing Mayfly needs, whether it has it, and what to do when it does not. */
export interface Check {
  readonly name: string;
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
}

/** A model to try: whether it has a key, and a way to ask its provider which models it has. */
export interface ModelProbe {
  readonly label: string;
  readonly model: string;
  readonly hasKey: boolean;
  readonly list: () => Promise<readonly string[]>;
}

export interface DoctorPorts {
  /** Podman's own version and its machine's, null when the machine does not answer, or undefined when there is no Podman. */
  readonly podman: () => Promise<{ readonly client: string; readonly server: string | null } | undefined>;
  readonly runtimeReady: () => Promise<boolean>;
  /** The sign-in service's containers' states, empty when it is not running. */
  readonly signIn: () => Promise<readonly string[]>;
  readonly models: () => Promise<readonly ModelProbe[]>;
}

const NEEDED_PODMAN = 5;

/** Looks at everything Mayfly needs to make and run apps, one check at a time. */
export async function examine(ports: DoctorPorts): Promise<Check[]> {
  const podman = await checkPodman(ports);
  const runtime = podman.status === "pass" ? [await checkRuntime(ports), await checkSignIn(ports)] : [];
  const models = await Promise.all((await ports.models()).map(checkModel));
  return [podman, ...runtime, ...models];
}

async function checkPodman({ podman }: DoctorPorts): Promise<Check> {
  const name = "Podman";
  const found = await podman();
  if (found === undefined) return { name, status: "fail", detail: "Mayfly cannot find Podman. Set it up from Podman Desktop's Dashboard." };
  if (found.server === null) return { name, status: "fail", detail: "Podman's machine does not answer. Start it from Podman Desktop's Dashboard." };
  const major = Number.parseInt(found.server, 10);
  if (major < NEEDED_PODMAN) return { name, status: "fail", detail: `Podman ${found.server} runs here; Mayfly needs ${NEEDED_PODMAN} or later. Update it from Podman Desktop.` };
  return { name, status: "pass", detail: `Podman ${found.server} is running.` };
}

async function checkRuntime({ runtimeReady }: DoctorPorts): Promise<Check> {
  const name = "App runtime";
  if (await runtimeReady()) return { name, status: "pass", detail: "The runtime every app runs on is downloaded." };
  return { name, status: "warn", detail: "The runtime every app runs on downloads with your first app, which then takes a little longer." };
}

async function checkSignIn({ signIn }: DoctorPorts): Promise<Check> {
  const name = "Sign-in service";
  const states = await signIn();
  if (states.length === 0) return { name, status: "warn", detail: "The sign-in service is not running. It starts when Mayfly runs an app." };
  if (states.every((state) => state === "running")) return { name, status: "pass", detail: "The sign-in service is running." };
  return { name, status: "fail", detail: "The sign-in service has stopped. Its logs, in Settings, say why." };
}

async function checkModel({ label, model, hasKey, list }: ModelProbe): Promise<Check> {
  if (!hasKey) return { name: label, status: "warn", detail: "No API key yet. Add one under Models." };
  try {
    const offered = await list();
    if (offered.includes(model)) return { name: label, status: "pass", detail: "Its provider accepts the key and has the model." };
    return { name: label, status: "warn", detail: `Its provider accepts the key but does not list ${model}. Check the model's name.` };
  } catch (error) {
    return { name: label, status: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}
