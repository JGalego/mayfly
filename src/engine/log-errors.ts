const ERROR_LEVELS = new Set(["error", "fatal"]);

/** The errors an app logged, as the JSON it wrote without the time, each once where it last appeared, the latest few. */
export function errorsIn(lines: readonly string[], most = 10): string[] {
  const errors = lines.flatMap((line) => {
    // Podman puts the time it read the line first.
    const written = line.slice(line.indexOf(" ") + 1);
    try {
      const { time: _time, ...fields } = JSON.parse(written) as Record<string, unknown>;
      return ERROR_LEVELS.has(String(fields.level)) ? [JSON.stringify(fields)] : [];
    } catch {
      return [];
    }
  });
  return errors.filter((error, at) => errors.lastIndexOf(error) === at).slice(-most);
}
