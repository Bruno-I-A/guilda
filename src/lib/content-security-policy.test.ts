import { describe, expect, test } from "vitest";

import { buildContentSecurityPolicy } from "./content-security-policy";

describe("Content Security Policy", () => {
  test("produção mantém nonce e strict-dynamic", () => {
    const policy = buildContentSecurityPolicy("nonce-test", true);
    expect(policy).toContain("script-src 'self' 'nonce-nonce-test' 'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  test("libera somente as superfícies necessárias ao Embedded Signup", () => {
    const policy = buildContentSecurityPolicy("nonce-test", false);
    expect(policy).toContain("https://connect.facebook.net");
    expect(policy).toContain(
      "connect-src 'self' https://graph.facebook.com https://www.facebook.com",
    );
    expect(policy).toContain(
      "frame-src https://www.facebook.com https://web.facebook.com",
    );
    expect(policy).toContain("form-action 'self' https://www.facebook.com");
    expect(policy).not.toContain("*.facebook.com");
  });
});
