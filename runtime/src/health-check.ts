// The container's liveness probe. The image has no shell or curl, so Node asks the app itself.
const response = await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`, { signal: AbortSignal.timeout(3000) }).catch(
  () => undefined,
);
process.exitCode = response?.ok ? 0 : 1;
