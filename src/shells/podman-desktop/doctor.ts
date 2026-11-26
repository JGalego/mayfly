/** One thing Mayfly needs, whether it has it, and what to do when it does not. */
export interface Check {
  readonly name: string;
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
}

/** How a model's key fares with its provider, shown on the model's own card. */
export interface ModelCheck {
  readonly id: string;
  readonly status: Check["status"];
  readonly detail: string;
}

/** Whether Mayfly is ready to make and run apps, and how each model fares. */
export interface Examination {
  readonly ready: readonly Check[];
  readonly models: readonly ModelCheck[];
}

/** A model to try: whether it has a key, which local providers often do without, and a way to ask its provider which models it has. */
export interface ModelProbe {
  readonly id: string;
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

/** Looks at everything Mayfly needs to make and run apps, one check at a time, and tries each model's key. */
export async function examine(ports: DoctorPorts): Promise<Examination> {
  const podman = await checkPodman(ports);
  const runtime = podman.status === "pass" ? [await checkRuntime(ports), await checkSignIn(ports)] : [];
  return { ready: [podman, ...runtime], models: await Promise.all((await ports.models()).map(checkModel)) };
}

async function checkPodman({ podman }: DoctorPorts): Promise<Check> {
  const name = "Podman";
  const found = await podman();
  if (found === undefined) return { name, status: "fail", detail: "Podman not found. Set it up in Podman Desktop's Dashboard." };
  if (found.server === null) return { name, status: "fail", detail: "Podman machine unavailable. Start it in Podman Desktop's Dashboard." };
  const major = Number.parseInt(found.server, 10);
  if (major < NEEDED_PODMAN) return { name, status: "fail", detail: `Podman ${found.server} is installed. Update to ${NEEDED_PODMAN} or later in Podman Desktop.` };
  return { name, status: "pass", detail: `Podman ${found.server} is running.` };
}

async function checkRuntime({ runtimeReady }: DoctorPorts): Promise<Check> {
  const name = "App runtime";
  if (await runtimeReady()) return { name, status: "pass", detail: "Runtime image downloaded." };
  return { name, status: "warn", detail: "The runtime image downloads when you build your first app." };
}

async function checkSignIn({ signIn }: DoctorPorts): Promise<Check> {
  const name = "Sign-in service";
  const states = await signIn();
  if (states.length === 0) return { name, status: "warn", detail: "The sign-in service starts when you run an app." };
  if (states.every((state) => state === "running")) return { name, status: "pass", detail: "Running." };
  return { name, status: "fail", detail: "The sign-in service is not running. Check its logs in Settings." };
}

async function checkModel({ id, model, hasKey, list }: ModelProbe): Promise<ModelCheck> {
  const access = hasKey ? "API key accepted." : "Connected without an API key.";
  try {
    const offered = await list();
    if (offered.includes(model)) return { id, status: "pass", detail: `${access} Model listed.` };
    return { id, status: "warn", detail: `${access} The provider does not list ${model}. Check the model name.` };
  } catch (error) {
    return { id, status: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}
