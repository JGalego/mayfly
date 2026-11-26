/** A page a browser ended up on after following redirects. */
export interface Page {
  readonly url: string;
  readonly status: number;
  readonly body: string;
}

/** Just enough of a browser to sign in: follows redirects and, like browsers on localhost, shares cookies across ports. */
export class Browser {
  readonly #cookies = new Map<string, string>();

  get(url: string): Promise<Page> {
    return this.#follow(url, { method: "GET" });
  }

  /** Submits the first form on a page. */
  submit(page: Page, fields: Record<string, string>): Promise<Page> {
    return this.#follow(formAction(page), { method: "POST", body: new URLSearchParams(fields) });
  }

  async #follow(url: string, init: RequestInit): Promise<Page> {
    let response = await this.#fetch(url, init);
    while (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get("location") ?? "", url).href;
      response = await this.#fetch(url, { method: "GET" });
    }
    return { url, status: response.status, body: await response.text() };
  }

  async #fetch(url: string, init: RequestInit): Promise<Response> {
    const cookie = [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetch(url, { ...init, redirect: "manual", headers: { accept: "text/html", cookie } });
    for (const setCookie of response.headers.getSetCookie()) this.#keep(setCookie);
    if (response.status >= 300 && response.status < 400) await response.body?.cancel();
    return response;
  }

  #keep(setCookie: string): void {
    const [pair = ""] = setCookie.split(";");
    const separator = pair.indexOf("=");
    this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function formAction(page: Page): string {
  const action = /<form[^>]*action="([^"]*)"/.exec(page.body)?.[1];
  if (action === undefined) throw new Error(`no form on ${page.url}`);
  return new URL(action.replaceAll("&amp;", "&"), page.url).href;
}
