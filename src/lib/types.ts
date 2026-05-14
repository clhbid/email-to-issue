export interface EmailPayload {
  subject: string;
  text: string;
  from: string;
  to: string;
  spf: string;
  dkim: string;
}

export interface ParsedIssue {
  title: string;
  context: string;
  acceptanceCriteria: string[];
}

export interface Config {
  allowedSenders: string[];
  inboundEmail: string;
  ghOwner: string;
  ghRepo: string;
  ghAppId: string;
  ghPrivateKey: string;
  ghInstallationId: string;
  geminiApiKey: string;
}

export interface IssueResult {
  url: string;
  number: number;
}
