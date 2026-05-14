import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { EmailPayload, ParsedIssue, Config, IssueResult } from "./types.js";

async function getInstallationToken(config: Config): Promise<string> {
  try {
    console.info("[Auth] Requesting GitHub App installation token");
    const auth = createAppAuth({
      appId: config.ghAppId,
      privateKey: config.ghPrivateKey,
      installationId: config.ghInstallationId,
    });
    const { token } = await auth({ type: "installation" });
    return token;
  } catch (error) {
    const err = error as Error;
    console.error(`[Auth Error] GitHub App token generation failed\n${err.stack}`);
    throw error;
  }
}

export async function createGithubIssue(
  email: EmailPayload,
  parsed: ParsedIssue | null,
  config: Config
): Promise<IssueResult> {
  const token = await getInstallationToken(config);

  try {
    const octokit = new Octokit({ auth: token });
    const title = parsed?.title || email.subject || "New Issue from Email";
    const body = buildIssueBody(email, parsed);
    const labels = parsed ? ["email-inbox", "ai-parsed"] : ["email-inbox"];

    const { data } = await octokit.rest.issues.create({
      owner: config.ghOwner,
      repo: config.ghRepo,
      title,
      body,
      labels,
    });

    console.info(`[GitHub] Issue created: ${data.html_url}`);
    return { url: data.html_url, number: data.number };
  } catch (error) {
    const err = error as Error;
    console.error(`[GitHub Error] Issue creation failed\n${err.stack}`);
    throw error;
  }
}

function buildIssueBody(email: EmailPayload, parsed: ParsedIssue | null): string {
  if (!parsed) {
    return `Sent by: ${email.from}\n\n${email.text}`;
  }

  const criteria = parsed.acceptanceCriteria.map((c) => `- ${c}`).join("\n");

  return [
    `Sent by: ${email.from}`,
    "",
    "## Issue Context",
    "",
    parsed.context,
    "",
    "## Acceptance Criteria",
    "",
    criteria,
    "",
    "<details><summary>View Original Email</summary>",
    "",
    email.text,
    "",
    "</details>",
  ].join("\n");
}
