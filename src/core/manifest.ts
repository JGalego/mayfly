import { requireMatch, requireObject, type Rule } from "./rules.ts";

/** A generated app as Mayfly knows it. No field can loosen the contract. */
export interface Manifest {
  readonly name: string;
  readonly image: string;
}

const NAME: Rule = {
  subject: "app name",
  // A DNS label, short enough to take Mayfly's prefixes and suffixes.
  pattern: /^(?=.{1,40}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  description: "lowercase letters, digits and inner hyphens, at most 40 characters",
};

const IMAGE: Rule = { subject: "app image", pattern: /^\S+$/, description: "an image reference without spaces" };

/** Reads untrusted input, keeping only the fields the contract defines. */
export function parseManifest(value: unknown): Manifest {
  const fields = requireObject(value, "manifest");
  return { name: requireMatch(fields.name, NAME), image: requireMatch(fields.image, IMAGE) };
}
