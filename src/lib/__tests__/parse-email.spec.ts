import { describe, it, expect } from "vitest";
import { parseEmail } from "../parse-email.js";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("parseEmail", () => {
  it("extracts all fields from a standard SendGrid payload", () => {
    const fd = makeFormData({
      subject: "Fix the login bug",
      text: "Users can't log in after the deploy.",
      from: "Alice <alice@example.com>",
      to: "new-issues@parse.clhbid.com",
      SPF: "pass",
      dkim: "{@example.com : pass}",
    });
    const result = parseEmail(fd);
    expect(result.subject).toBe("Fix the login bug");
    expect(result.text).toBe("Users can't log in after the deploy.");
    expect(result.from).toBe("Alice <alice@example.com>");
    expect(result.to).toBe("new-issues@parse.clhbid.com");
    expect(result.spf).toBe("pass");
    expect(result.dkim).toBe("{@example.com : pass}");
  });

  it("returns empty strings for missing fields", () => {
    const fd = makeFormData({});
    const result = parseEmail(fd);
    expect(result.subject).toBe("");
    expect(result.text).toBe("");
    expect(result.from).toBe("");
    expect(result.to).toBe("");
    expect(result.spf).toBe("");
    expect(result.dkim).toBe("");
  });

  it("handles subject with no text body", () => {
    const fd = makeFormData({ subject: "Quick note", SPF: "pass" });
    const result = parseEmail(fd);
    expect(result.subject).toBe("Quick note");
    expect(result.text).toBe("");
    expect(result.spf).toBe("pass");
  });
});
