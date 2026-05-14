import type { EmailPayload, Config } from "./types.js";

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].trim() : from.trim();
}

export function validateEmail(
  email: EmailPayload,
  config: Config
): { ok: boolean; status: number } {
  if (email.to !== config.inboundEmail) {
    console.warn(`[Validation] Rejected: destination mismatch (got ${email.to})`);
    return { ok: false, status: 403 };
  }

  const senderAddr = extractAddress(email.from);
  if (!config.allowedSenders.includes(senderAddr)) {
    console.warn(`[Validation] Sender ${email.from} rejected: not on allowlist`);
    return { ok: false, status: 403 };
  }
  console.info(`[Validation] Sender ${email.from} allowed`);

  const spfFailed = email.spf === "fail" || email.spf === "softfail";
  const dkimPassed = email.dkim.includes("pass");
  console.info(`[Validation] SPF: ${email.spf}, DKIM: ${email.dkim}`);

  if (spfFailed || !dkimPassed) {
    console.warn(`[Validation] Rejected: SPF/DKIM check failed`);
    return { ok: false, status: 401 };
  }

  return { ok: true, status: 200 };
}
