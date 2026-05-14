import { parseEmail } from "../../src/lib/parse-email.js";
import { validateEmail } from "../../src/lib/validate-email.js";
import { processWithGemini } from "../../src/lib/ai.js";
import { createGithubIssue } from "../../src/lib/github.js";
import type { Config } from "../../src/lib/types.js";

const config: Config = {
  allowedSenders: (process.env.ALLOWED_SENDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  inboundEmail: process.env.INBOUND_EMAIL ?? "",
  ghOwner: process.env.GH_OWNER ?? "",
  ghRepo: process.env.GH_REPO ?? "",
  ghAppId: process.env.GH_APP_ID ?? "",
  ghPrivateKey: process.env.GH_PRIVATE_KEY ?? "",
  ghInstallationId: process.env.GH_INSTALLATION_ID ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
};

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  const email = parseEmail(await req.formData());
  console.info(`[Init] Function triggered, to: ${email.to}`);

  const check = validateEmail(email, config);
  if (!check.ok) return new Response("", { status: check.status });

  const parsed = await processWithGemini(email.text, config.geminiApiKey);
  const result = await createGithubIssue(email, parsed, config);
  return new Response(JSON.stringify({ url: result.url }), { status: 200 });
};
