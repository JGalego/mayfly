import type { AppView, ServiceHealth } from "../../../engine/engine.ts";

export type Colour = "green" | "yellow" | "orange" | "red" | "grey" | "unknown";

/** A traffic light for an app, and what it means in words. */
export interface Light {
  readonly colour: Colour;
  readonly meaning: string;
}

/**
 * Green runs, yellow runs but has restarted, orange is being worked on, red has stopped, grey has never run.
 * Unknown means Podman has not been asked yet.
 */
export function lightFor(app: AppView, health: readonly ServiceHealth[] | undefined, working: string | null | undefined): Light {
  if (working === app.name) return { colour: "orange", meaning: "Mayfly is working on it" };
  if (app.head === null) return { colour: "grey", meaning: "Not running yet: no attempt has passed" };
  if (health === undefined) return { colour: "unknown", meaning: "Asking Podman how it is doing" };
  const containers = health.find((service) => service.kind === "app" && service.name === app.name)?.containers ?? [];
  if (containers.length === 0) return { colour: "red", meaning: "Not running" };
  if (containers.some((container) => container.state !== "running")) return { colour: "red", meaning: "Stopped" };
  const restarts = containers.reduce((sum, container) => sum + container.restarts, 0);
  if (restarts > 0) return { colour: "yellow", meaning: `Running, but it restarted ${restarts} ${restarts === 1 ? "time" : "times"}` };
  return { colour: "green", meaning: "Running" };
}
