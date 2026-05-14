import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailPayload, ParsedIssue, Config } from "../types.js";

const mockAuth = vi.fn();
const mockCreateAppAuth = vi.fn(() => mockAuth);

const mockIssuesCreate = vi.fn();
const MockOctokit = vi.fn().mockImplementation(() => ({
  rest: { issues: { create: mockIssuesCreate } },
}));

vi.mock("@octokit/auth-app", () => ({ createAppAuth: mockCreateAppAuth }));
vi.mock("@octokit/rest", () => ({ Octokit: MockOctokit }));

const { createGithubIssue } = await import("../github.js");

const config: Config = {
  allowedSenders: ["alice@example.com"],
  inboundEmail: "new-issues@parse.clhbid.com",
  ghOwner: "testorg",
  ghRepo: "testrepo",
  ghAppId: "123",
  ghPrivateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
  ghInstallationId: "456",
  geminiApiKey: "",
};

const email: EmailPayload = {
  subject: "Fix the login page",
  text: "Users can't log in.",
  from: "alice@example.com",
  to: "new-issues@parse.clhbid.com",
  spf: "pass",
  dkim: "{@example.com : pass}",
};

const parsed: ParsedIssue = {
  title: "Fix login page authentication failure",
  context: "Users experience login failures after the recent deploy.",
  acceptanceCriteria: ["Users can log in successfully", "Error messages are clear"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ token: "ghs_test_token" });
  mockIssuesCreate.mockResolvedValue({
    data: { html_url: "https://github.com/testorg/testrepo/issues/42", number: 42 },
  });
});

describe("createGithubIssue", () => {
  it("returns the issue URL and number on success", async () => {
    const result = await createGithubIssue(email, parsed, config);
    expect(result).toEqual({
      url: "https://github.com/testorg/testrepo/issues/42",
      number: 42,
    });
  });

  it("uses AI title when parsed is provided", async () => {
    await createGithubIssue(email, parsed, config);
    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fix login page authentication failure" })
    );
  });

  it("falls back to email subject when parsed is null", async () => {
    await createGithubIssue(email, null, config);
    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fix the login page" })
    );
  });

  it("falls back to default title when both parsed and subject are empty", async () => {
    const emailNoSubject = { ...email, subject: "" };
    await createGithubIssue(emailNoSubject, null, config);
    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Issue from Email" })
    );
  });

  it("builds full markdown body when parsed is provided", async () => {
    await createGithubIssue(email, parsed, config);
    const body = mockIssuesCreate.mock.calls[0][0].body as string;
    expect(body).toContain("Sent by: alice@example.com");
    expect(body).toContain("## Issue Context");
    expect(body).toContain("Users experience login failures after the recent deploy.");
    expect(body).toContain("## Acceptance Criteria");
    expect(body).toContain("- Users can log in successfully");
    expect(body).toContain("- Error messages are clear");
    expect(body).toContain("<details><summary>View Original Email</summary>");
    expect(body).toContain("Users can't log in.");
  });

  it("uses placeholder body when parsed is null", async () => {
    await createGithubIssue(email, null, config);
    const body = mockIssuesCreate.mock.calls[0][0].body as string;
    expect(body).toContain("Sent by: alice@example.com");
    expect(body).toContain("Users can't log in.");
  });

  it("uses email-inbox label only when parsed is null", async () => {
    await createGithubIssue(email, null, config);
    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["email-inbox"] })
    );
  });

  it("uses both labels when parsed is provided", async () => {
    await createGithubIssue(email, parsed, config);
    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["email-inbox", "ai-parsed"] })
    );
  });

  it("throws and logs [Auth Error] when token generation fails", async () => {
    mockAuth.mockRejectedValue(new Error("bad credentials"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(createGithubIssue(email, parsed, config)).rejects.toThrow("bad credentials");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[Auth Error]"));
    consoleSpy.mockRestore();
  });

  it("throws and logs [GitHub Error] when issue creation fails", async () => {
    mockIssuesCreate.mockRejectedValue(new Error("API limit"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(createGithubIssue(email, parsed, config)).rejects.toThrow("API limit");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[GitHub Error]"));
    consoleSpy.mockRestore();
  });
});
