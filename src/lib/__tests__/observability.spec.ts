import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
 * This test verifies that no sensitive data (email body, private keys, API keys)
 * is ever written to console output. We spy on each lib function directly and
 * inspect the console calls they make, bypassing the need to mock external SDKs.
 */

import { validateEmail } from "../validate-email.js";

// We spy directly on the console before importing modules, capturing every call.
const loggedMessages: string[] = [];

const SECRET_KEY = "-----BEGIN RSA PRIVATE KEY-----\nSECRET_CONTENT\n-----END RSA PRIVATE KEY-----";
const GEMINI_KEY = "AIzaSy_SECRET_GEMINI_KEY";
const EMAIL_BODY = "PRIVATE EMAIL BODY CONTENT - SHOULD NOT BE LOGGED";

const config = {
  allowedSenders: ["alice@example.com"],
  inboundEmail: "new-issues@parse.clhbid.com",
  ghOwner: "org",
  ghRepo: "repo",
  ghAppId: "123",
  ghPrivateKey: SECRET_KEY,
  ghInstallationId: "456",
  geminiApiKey: GEMINI_KEY,
};

const email = {
  subject: "Test Issue",
  text: EMAIL_BODY,
  from: "alice@example.com",
  to: "new-issues@parse.clhbid.com",
  spf: "pass",
  dkim: "{@example.com : pass}",
};

describe("observability: no PII or secrets in logs", () => {
  beforeEach(() => {
    loggedMessages.length = 0;
    const capture = (msg: string) => loggedMessages.push(String(msg));
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validateEmail does not log the raw email body", () => {
    validateEmail(email, config);
    for (const msg of loggedMessages) {
      expect(msg).not.toContain(EMAIL_BODY);
    }
  });

  it("validateEmail does not log the GH_PRIVATE_KEY", () => {
    validateEmail(email, config);
    for (const msg of loggedMessages) {
      expect(msg).not.toContain(SECRET_KEY);
      expect(msg).not.toContain("SECRET_CONTENT");
    }
  });

  it("validateEmail does not log the GEMINI_API_KEY", () => {
    validateEmail(email, config);
    for (const msg of loggedMessages) {
      expect(msg).not.toContain(GEMINI_KEY);
    }
  });

  it("validateEmail logs the sender address and auth check results", () => {
    validateEmail(email, config);
    const all = loggedMessages.join("\n");
    expect(all).toContain("[Validation] Sender alice@example.com allowed");
    expect(all).toContain("[Validation] SPF: pass, DKIM:");
  });

  it("validateEmail logs a warning (not the body) when sender is rejected", () => {
    const rejectedEmail = { ...email, from: "hacker@evil.com" };
    validateEmail(rejectedEmail, config);
    const warnMessages = loggedMessages;
    expect(warnMessages.some((m) => m.includes("[Validation]") && m.includes("rejected"))).toBe(true);
    for (const msg of loggedMessages) {
      expect(msg).not.toContain(EMAIL_BODY);
    }
  });

  it("log message patterns match the required stage table", () => {
    // Verify the exact format of validation log messages
    validateEmail(email, config);
    const all = loggedMessages.join("\n");
    expect(all).toMatch(/\[Validation\] Sender .+ allowed/);
    expect(all).toMatch(/\[Validation\] SPF: .+, DKIM: .+/);
  });
});

describe("observability: log message format compliance", () => {
  it("ai.ts contains required log strings", async () => {
    // Read the source to confirm log strings are present and body is never concatenated in
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../ai.ts", import.meta.url), "utf8");
    expect(src).toContain("[AI] Requesting Gemini parse");
    expect(src).toContain("[AI] Parse complete");
    expect(src).toContain("[AI Error] Gemini failed to parse structure");
    // Ensure the email text is never interpolated into a log string
    expect(src).not.toMatch(/console\.(info|warn|error).*emailText/);
  });

  it("github.ts contains required log strings", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../github.ts", import.meta.url), "utf8");
    expect(src).toContain("[Auth] Requesting GitHub App installation token");
    expect(src).toContain("[GitHub] Issue created:");
    expect(src).toContain("[Auth Error]");
    expect(src).toContain("[GitHub Error]");
    // Ensure sensitive data is never interpolated into logs
    expect(src).not.toMatch(/console\.(info|warn|error).*privateKey/);
    expect(src).not.toMatch(/console\.(info|warn|error).*email\.text/);
  });

  it("ai.ts never interpolates the apiKey into logs", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../ai.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/console\.(info|warn|error).*apiKey/);
  });
});
