import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.fn();
const MockGoogleGenAI = vi.fn().mockImplementation(() => ({
  models: { generateContent: mockGenerateContent },
}));

vi.mock("@google/genai", () => ({ GoogleGenAI: MockGoogleGenAI }));

const { processWithGemini } = await import("../ai.js");

const validResponse = {
  title: "Fix login page authentication failure",
  context: "Users cannot log in after the recent deploy due to a broken auth check.",
  acceptanceCriteria: ["Users can log in successfully", "Error messages are descriptive"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateContent.mockResolvedValue({ text: JSON.stringify(validResponse) });
});

describe("processWithGemini", () => {
  it("returns a ParsedIssue with title, context, and acceptanceCriteria", async () => {
    const result = await processWithGemini("Users can't log in.", "test-api-key");
    expect(result.title).toBe("Fix login page authentication failure");
    expect(result.context).toContain("broken auth check");
    expect(result.acceptanceCriteria).toHaveLength(2);
    expect(result.acceptanceCriteria[0]).toBe("Users can log in successfully");
  });

  it("passes the correct model and config to the API", async () => {
    await processWithGemini("Some email text", "test-api-key");
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.0-flash");
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseSchema.required).toContain("title");
    expect(call.config.responseSchema.required).toContain("context");
    expect(call.config.responseSchema.required).toContain("acceptanceCriteria");
  });

  it("includes the email text in the user message", async () => {
    const emailText = "The checkout button is broken.";
    await processWithGemini(emailText, "test-api-key");
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.contents[0].parts[0].text).toBe(emailText);
  });

  it("includes a system instruction", async () => {
    await processWithGemini("Some email", "test-api-key");
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.systemInstruction).toContain("technical product manager");
  });

  it("throws and logs [AI Error] when API call fails", async () => {
    mockGenerateContent.mockRejectedValue(new Error("quota exceeded"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(processWithGemini("email text", "key")).rejects.toThrow("quota exceeded");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[AI Error]"));
    consoleSpy.mockRestore();
  });

  it("throws when result text is not valid JSON", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not-json" });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(processWithGemini("email text", "key")).rejects.toThrow();
    consoleSpy.mockRestore();
  });
});
