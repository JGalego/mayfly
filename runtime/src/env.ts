import type { SecureHeadersVariables } from "hono/secure-headers";

/** Who is signed in, as the auth proxy in front of the app says. */
export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly groups: readonly string[];
}

/** What a generated app's routes can read: `c.get("user")`, and the nonce its inline scripts need. */
export type Env = { Variables: { user: User } & SecureHeadersVariables };
