import type { PhoneNetworkStatus } from "../../engine/ports.ts";

/** How a check came out. */
export type Outcome = "pass" | "warn" | "fail";

/** One thing Mayfly needs, whether it has it, and what to do when it does not. Checking while the doctor looks, and skipped when what it depends on isn't there. */
export interface Check {
  readonly name: string;
  readonly status: Outcome | "checking" | "skip";
  readonly detail: string;
}

/** How a model's key fares with its provider, shown on the model's own card. */
export interface ModelCheck {
  readonly id: string;
  readonly status: Outcome;
  readonly detail: string;
}

/** Whether Mayfly is ready to make and run apps, and how each model fares. */
export interface Examination {
  readonly ready: readonly Check[];
  readonly models: readonly ModelCheck[];
}

/** A model to try, and a way to ask its provider which models it has. */
export interface ModelProbe {
  readonly id: string;
  readonly model: string;
  readonly list: () => Promise<readonly string[]>;
}

export interface DoctorPorts {
  /** Podman's own version and its machine's, null when the machine does not answer, or undefined when there is no Podman. */
  readonly podman: () => Promise<{ readonly client: string; readonly server: string | null } | undefined>;
  readonly runtimeReady: () => Promise<boolean>;
  /** The sign-in service's containers' states, empty when it is not running. */
  readonly signIn: () => Promise<readonly string[]>;
  readonly models: () => Promise<readonly ModelProbe[]>;
  /** The computer's name the phone opens apps on, or null while phone access is off. */
  readonly phoneHost: () => Promise<string | null>;
  readonly phoneNetwork: () => Promise<PhoneNetworkStatus>;
}

const NEEDED_PODMAN = 5;

const PODMAN = "Podman";
const RUNTIME = "App runtime";
const SIGN_IN = "Sign-in service";
const PHONE = "Phone access";

/** Looks at everything Mayfly needs to make and run apps, one check at a time, and tries each model's key meanwhile. Tells what it
 * knows so far: first every check it will make, then again as each one finishes, the last time with what it returns. */
export async function examine(ports: DoctorPorts, tell: (sofar: Examination) => void = () => {}): Promise<Examination> {
  const host = await ports.phoneHost();
  const ready: Check[] = [PODMAN, RUNTIME, SIGN_IN, ...(host === null ? [] : [PHONE])].map((name) => ({ name, status: "checking", detail: "" }));
  // In the models' own order, whichever answers first.
  const models: (ModelCheck | undefined)[] = [];
  const sofar = (): Examination => ({ ready: [...ready], models: models.filter((check) => check !== undefined) });
  const found = (check: Check): void => {
    ready[ready.findIndex(({ name }) => name === check.name)] = check;
    tell(sofar());
  };
  tell(sofar());
  const modelsTried = ports.models().then((probes) =>
    Promise.all(
      probes.map(async (probe, at) => {
        models[at] = await checkModel(probe);
        tell(sofar());
      }),
    ),
  );
  const podman = await checkPodman(ports);
  found(podman);
  if (podman.status === "pass") {
    found(await checkRuntime(ports));
    found(await checkSignIn(ports));
  } else {
    for (const name of [RUNTIME, SIGN_IN]) found({ name, status: "skip", detail: "Waits for Podman" });
  }
  if (host !== null) found(await checkPhone(host, ports));
  await modelsTried;
  return sofar();
}

async function checkPodman({ podman }: DoctorPorts): Promise<Check> {
  const name = PODMAN;
  const found = await podman();
  if (found === undefined) return { name, status: "fail", detail: "Set up Podman in Podman Desktop's Dashboard" };
  if (found.server === null) return { name, status: "fail", detail: "Start the Podman machine in Podman Desktop's Dashboard" };
  const major = Number.parseInt(found.server, 10);
  if (major < NEEDED_PODMAN) return { name, status: "fail", detail: `Update Podman ${found.server} to ${NEEDED_PODMAN} or later in Podman Desktop` };
  return { name, status: "pass", detail: `Podman ${found.server} is running` };
}

async function checkRuntime({ runtimeReady }: DoctorPorts): Promise<Check> {
  const name = RUNTIME;
  if (await runtimeReady()) return { name, status: "pass", detail: "Runtime image downloaded" };
  return { name, status: "warn", detail: "Downloads when you build your first app" };
}

async function checkSignIn({ signIn }: DoctorPorts): Promise<Check> {
  const name = SIGN_IN;
  const states = await signIn();
  if (states.length === 0) return { name, status: "warn", detail: "Starts when you run an app" };
  if (states.every((state) => state === "running")) return { name, status: "pass", detail: "Running" };
  return { name, status: "fail", detail: "Check its logs in Settings" };
}

async function checkPhone(host: string, { phoneNetwork }: DoctorPorts): Promise<Check> {
  const name = PHONE;
  const network = await phoneNetwork();
  if (network.state !== "ready") return { name, status: "fail", detail: tailscaleProblem(network) };
  if (network.host !== host) return { name, status: "warn", detail: `Turn phone access off and on to use the new name ${network.host}` };
  return { name, status: "pass", detail: `Your phone opens apps at ${host}` };
}

// The card says whether a key is saved, so this says only whether the model works.
async function checkModel({ id, model, list }: ModelProbe): Promise<ModelCheck> {
  try {
    const offered = await list();
    if (offered.includes(model)) return { id, status: "pass", detail: "Ready" };
    return { id, status: "warn", detail: `The provider doesn't list ${model}` };
  } catch (error) {
    return { id, status: "fail", detail: firstSentence(error instanceof Error ? error.message : String(error)) };
  }
}

// The banner for turning phone access on says what to try next. A finding says only what to fix.
function tailscaleProblem(status: Exclude<PhoneNetworkStatus, { readonly state: "ready" }>): string {
  switch (status.state) {
    case "missing":
      return "Install Tailscale from tailscale.com/download and sign in";
    case "off":
      return "Turn Tailscale on";
    case "signed-out":
      return "Sign in to Tailscale";
    case "no-https":
      return "Choose Enable HTTPS under DNS in Tailscale's admin console";
    case "other-user":
      return `Run Podman Desktop as ${status.user} who runs Tailscale`;
    case "failed":
      return "Mayfly can't read Tailscale's status";
  }
}

// Errors come from the provider's adapter as sentences for a banner. A finding keeps the first, without its full stop.
function firstSentence(message: string): string {
  return (message.split(". ")[0] ?? "").replace(/\.$/, "").replaceAll(",", "");
}
