import type { EmailPayload } from "./types.js";

export function parseEmail(formData: FormData): EmailPayload {
  return {
    subject: (formData.get("subject") as string) ?? "",
    text: (formData.get("text") as string) ?? "",
    from: (formData.get("from") as string) ?? "",
    to: (formData.get("to") as string) ?? "",
    spf: (formData.get("SPF") as string) ?? "",
    dkim: (formData.get("dkim") as string) ?? "",
  };
}
