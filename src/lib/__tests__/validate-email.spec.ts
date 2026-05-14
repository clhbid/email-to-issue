import { describe, it, expect } from "vitest";
import { validateEmail } from "../validate-email.js";
import type { EmailPayload, Config } from "../types.js";

const config: Config = {
  allowedSenders: ["alice@example.com"],
  inboundEmail: "new-issues@parse.clhbid.com",
  ghOwner: "",
  ghRepo: "",
  ghAppId: "",
  ghPrivateKey: "",
  ghInstallationId: "",
  geminiApiKey: "",
};

const validEmail: EmailPayload = {
  subject: "Test",
  text: "Body",
  from: "Alice <alice@example.com>",
  to: "new-issues@parse.clhbid.com",
  spf: "pass",
  dkim: "{@example.com : pass}",
};

describe("validateEmail", () => {
  it("returns ok for a fully valid email", () => {
    expect(validateEmail(validEmail, config)).toEqual({ ok: true, status: 200 });
  });

  it("rejects when destination does not match inboundEmail", () => {
    const email = { ...validEmail, to: "wrong@other.com" };
    expect(validateEmail(email, config)).toEqual({ ok: false, status: 403 });
  });

  it("rejects when sender is not on the allowlist", () => {
    const email = { ...validEmail, from: "eve@evil.com" };
    expect(validateEmail(email, config)).toEqual({ ok: false, status: 403 });
  });

  it("accepts sender in bare address format (no display name)", () => {
    const email = { ...validEmail, from: "alice@example.com" };
    expect(validateEmail(email, config)).toEqual({ ok: true, status: 200 });
  });

  it("rejects when SPF is fail", () => {
    const email = { ...validEmail, spf: "fail" };
    expect(validateEmail(email, config)).toEqual({ ok: false, status: 401 });
  });

  it("rejects when SPF is softfail", () => {
    const email = { ...validEmail, spf: "softfail" };
    expect(validateEmail(email, config)).toEqual({ ok: false, status: 401 });
  });

  it("rejects when DKIM does not contain pass", () => {
    const email = { ...validEmail, dkim: "{@example.com : fail}" };
    expect(validateEmail(email, config)).toEqual({ ok: false, status: 401 });
  });
});
