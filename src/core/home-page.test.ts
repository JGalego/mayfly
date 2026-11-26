import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homePageProblem } from "./home-page.ts";

const html = "text/html; charset=UTF-8";

describe("homePageProblem", () => {
  it("passes an HTML page with a link to sign out", () => {
    assert.equal(homePageProblem({ status: 200, type: html, body: '<h1>Bills</h1><a href="/oauth2/sign_out">Sign out</a>' }), null);
  });

  it("passes the link however the attribute is quoted or spaced, and a form that signs out", () => {
    for (const body of ["<a href=/oauth2/sign_out>x</a>", "<a class='quiet' href = '/oauth2/sign_out?rd=/'>x</a>", '<form method="get" action="/oauth2/sign_out"><button>x</button></form>']) {
      assert.equal(homePageProblem({ status: 200, type: html, body }), null, body);
    }
  });

  it("says what came back when the home page is not an HTML page", () => {
    assert.equal(homePageProblem({ status: 404, type: "text/plain", body: "404 Not Found" }), "GET / answered 404 text/plain, not an HTML page.");
    assert.equal(homePageProblem({ status: 200, type: "", body: "" }), "GET / answered 200 with no content type, not an HTML page.");
  });

  it("asks for a sign-out link when the page has none, or only mentions the address", () => {
    for (const body of ["<h1>Bills</h1>", "<p>Sign out at /oauth2/sign_out</p>"]) {
      assert.match(homePageProblem({ status: 200, type: html, body }) ?? "", /no link to \/oauth2\/sign_out/, body);
    }
  });
});
