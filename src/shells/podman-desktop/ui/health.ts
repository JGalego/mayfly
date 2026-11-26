import type { ServiceHealth } from "../../../engine/engine.ts";
import { h } from "./dom.ts";

type Verdict = "running" | "stopped" | "missing";

const VERDICT: Record<Verdict, string> = { running: "✓ Running", stopped: "✗ Stopped", missing: "✗ Not running" };

/** Each app and the sign-in service, and how their containers are doing, as Podman sees them. */
export function healthView(services: readonly ServiceHealth[] | undefined): HTMLElement[] {
  if (services === undefined) return [h("li", "quiet", "Asking Podman…")];
  return services.map((service) => {
    const verdict = verdictOf(service);
    const name = h("p", "health-name", service.name, h("span", `pill ${verdict}`, VERDICT[verdict]));
    const containers = service.containers.map(({ name: container, status, restarts }) => {
      const restarted = restarts === 0 ? "" : ` · restarted ${restarts} ${restarts === 1 ? "time" : "times"}`;
      return h("li", restarts === 0 ? "" : "restarted", `${container}: ${status}${restarted}`);
    });
    return h("li", "health-row", name, h("ul", "quiet containers", ...containers));
  });
}

function verdictOf({ containers }: ServiceHealth): Verdict {
  if (containers.length === 0) return "missing";
  return containers.every((container) => container.state === "running") ? "running" : "stopped";
}
