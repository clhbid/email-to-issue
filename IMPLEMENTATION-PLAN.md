# Plan: Email-to-GitHub Issue Service

## Context

Build a serverless Netlify Function (V2, TypeScript, Node.js 22) that:

1. Receives email webhooks from Twilio SendGrid Inbound Parse
2. Validates the sender (allowlist + SPF/DKIM)
3. Parses the email body with Google Gemini (structured output)
4. Creates a formatted GitHub issue via a GitHub App

The project is empty — no source code or config exists yet. The spec lives in `ACCEPTANCE-CRITERIA.md`.

---

## Code Architecture

The Netlify function handler is intentionally minimal — its only responsibility is parsing the raw `Request` into typed business objects and wiring lib calls together:

```ts
// netlify/functions/inbound-email.ts
export default async (req: Request) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  const email = parseEmail(await req.formData()); // EmailPayload
  const check = validateEmail(email, loadConfig()); // { ok, status }
  if (!check.ok) return new Response("", { status: check.status });
  const parsed = await processWithGemini(email.text); // ParsedIssue
  const result = await createGithubIssue(email, parsed, loadConfig());
  return new Response(JSON.stringify({ url: result.url }), { status: 200 });
};
```

**Shared types (`src/lib/types.ts`):**

```ts
interface EmailPayload {
  subject: string;
  text: string;
  from: string;
  to: string;
  spf: string;
  dkim: string;
}
interface ParsedIssue {
  title: string;
  context: string;
  acceptanceCriteria: string[];
}
interface Config {
  allowedSenders: string[];
  inboundEmail: string;
  ghOwner: string;
  ghRepo: string; /* ... */
}
interface IssueResult {
  url: string;
  number: number;
}
```

Each lib module (`parse-email.ts`, `validate-email.ts`, `ai.ts`, `github.ts`) exports a single focused function with no side effects beyond logging and API calls. This makes them straightforward to unit test.

---

## Testing Strategy

Tests live under `src/lib/__tests__/`. Because lib functions take plain objects (not raw `Request`), tests need no Netlify mocks — only API client mocks.

- **M1:** `parse-email.spec.ts` — test `parseEmail(formData)` with mock FormData inputs
- **M2:** `validate-email.spec.ts` — test each rejection branch (allowlist fail → 403, SPF fail → 401, DKIM fail → 401, destination mismatch → 403)
- **M3:** `github.spec.ts` — test issue body/title assembly; mock `@octokit/auth-app` and `@octokit/rest`
- **M4:** `ai.spec.ts` — test `processWithGemini`; mock `@google/genai`; test title fallback logic
- **M5:** `observability.spec.ts` — spy on `console` methods; confirm no call receives raw email body or key material

**Dev dependency:** `vitest`

---

## Milestones (incremental — deploy after each)

### Milestone 1 — Project Scaffold & Basic Function (Deploy First)

**Goal:** A deployable Netlify function that accepts a POST, parses form data, and returns 200. Proves the infrastructure pipeline works end-to-end before adding business logic.

**Files to create:**

- `package.json` — Node.js 22, ESM, with all runtime deps
- `tsconfig.json` — strict TypeScript targeting ES2022
- `netlify.toml` — Functions V2, esbuild bundler
- `.gitignore`
- `.env.example` — all required env vars documented
- `src/lib/types.ts` — `EmailPayload`, `ParsedIssue`, `Config`, `IssueResult`
- `src/lib/parse-email.ts` — `parseEmail(formData: FormData): EmailPayload`
- `netlify/functions/inbound-email.ts` — thin handler (wires lib calls together)

**Dependencies:**

```
@google/genai
@octokit/auth-app
@octokit/rest
@netlify/functions   (dev)
typescript           (dev)
vitest               (dev)
```

**Skeleton function behaviour:**

- `POST` only → return 405 for all other methods
- Call `parseEmail(await req.formData())` → `EmailPayload`
- `console.info('[Init] Function triggered, to:', email.to)`
- Return `200 OK`

**`parseEmail` responsibility:**

- Extract `subject`, `text`, `from`, `to`, `SPF`, `dkim` from form fields
- Normalize field names (SendGrid sends `SPF`, `dkim` as-is)
- Return typed `EmailPayload`

**netlify.toml:**

```toml
[functions]
  node_bundler = "esbuild"
  directory = "netlify/functions"
```

---

### Milestone 2 — Email Security Validation

**Goal:** Reject unauthorized/spoofed emails before touching any external API.

**New file: `src/lib/validate-email.ts`** — `validateEmail(email: EmailPayload, config: Config): { ok: boolean; status: number }`

Checks in order:

1. **Destination check** — `email.to` must match `config.inboundEmail` → `{ ok: false, status: 403 }`
2. **Sender allowlist** — extract address from `"Name <addr>"` format; must be in `config.allowedSenders` → `{ ok: false, status: 403 }`
3. **SPF/DKIM check** — `email.spf` must not be `fail`/`softfail`; `email.dkim` must contain `pass` → `{ ok: false, status: 401 }`

Log each result with `console.info('[Validation] ...')` / `console.warn('[Validation] Rejected ...')`.

**Handler change:** call `validateEmail` and return early if `!check.ok`.

**New env var:** `INBOUND_EMAIL` (e.g. `new-issues@parse.clhbid.com`)

---

### Milestone 3 — GitHub App Auth + Issue Creation

**Goal:** A real issue appears in the target repo when a valid email is received.

**New file: `src/lib/github.ts`** — `createGithubIssue(email: EmailPayload, parsed: ParsedIssue | null, config: Config): Promise<IssueResult>`

(In M3, `parsed` is `null`; M4 passes the real `ParsedIssue`.)

```ts
// GitHub App token
const auth = createAppAuth({ appId, privateKey, installationId });
const { token } = await auth({ type: "installation" });

// Issue creation
const octokit = new Octokit({ auth: token });
const { data } = await octokit.rest.issues.create({
  owner,
  repo,
  title: parsed?.title || email.subject || "New Issue from Email", // M4 populates parsed
  body: `Sent by: ${email.from}\n\n${email.text}`, // placeholder body, refined in M4
  labels: ["email-inbox"],
});
return { url: data.html_url, number: data.number };
```

Log `[Auth] Requesting GitHub App installation token` before the token call.
On error: log `[Auth Error]` or `[GitHub Error]` with `error.stack`; rethrow so handler returns 500.

**Required env vars:** `GH_APP_ID`, `GH_PRIVATE_KEY`, `GH_INSTALLATION_ID`, `GH_OWNER`, `GH_REPO`

---

### Milestone 4 — AI Processing with Google Gemini

**Goal:** Issues contain structured context and acceptance criteria extracted by AI.

**New file: `src/lib/ai.ts`** — `processWithGemini(emailText: string, apiKey: string): Promise<ParsedIssue>`

```ts
const genAI = new GoogleGenAI({ apiKey });
const result = await genAI.models.generateContent({
  model: "gemini-2.0-flash",
  contents: [{ role: "user", parts: [{ text: emailText }] }],
  config: {
    systemInstruction: SYSTEM_PROMPT,
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        context: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
      },
      required: ["title", "context", "acceptanceCriteria"],
    },
  },
});
const parsed = JSON.parse(result.text);
// typed as { title: string; context: string; acceptanceCriteria: string[] }
```

**Issue title resolution** (prefer AI title → email subject → fallback):

```ts
const issueTitle = parsed.title || subject || "New Issue from Email";
```

**System prompt** (constant in the file, with two few-shot examples based on real CLHbid.com issues):

```
You are a technical product manager for CLHbid.com. Extract the core issue or request from the following client email and return structured JSON. Be concise and actionable. Do not invent requirements that are not in the email.

The "title" field must be a short, specific, imperative-mood GitHub issue title (5–12 words). Study these examples of ideal titles from the CLHbid.com repository:

EXAMPLE 1
Email: "Hey team — noticed that our analytics are logging events under 'landlord' but the website copy and backend all say 'renting out'. Devon will need to confirm we can safely change the event names without breaking dashboards, but it's confusing having mismatched terminology. Found this while cleaning up the new renting-out work."
Output: {"title":"Update 'landlord' telemetry names to 'rentingOut' to match copy and back end code","context":"Analytics events use the term 'landlord' while the rest of the codebase and UI use 'renting out'. This inconsistency is confusing and should be corrected once Devon confirms the change won't break existing dashboards.","acceptanceCriteria":["Confirm with Devon that renaming telemetry events won't impact existing metrics dashboards","Update all telemetry signals from 'landlord' to 'rentingOut'"]}

EXAMPLE 2
Email: "The questionnaire landing page is disorienting — users land and can immediately see both the hero banner and the first question at the same time, so there's no clear 'start here' moment. I'd like an introduction screen inside the questionnaire card that shows the hero image, title, subtitle, and a Get Started button that fits without scrolling on both desktop and mobile. Clicking Get Started moves them to question 1, and Back on question 1 should return to the intro. Start Over should also go back to intro, not question 1."
Output: {"title":"Add introduction slide to SaleStrategyQuestionnaire","context":"The questionnaire page currently shows the hero banner and first question simultaneously, which disorients users. An intro slide inside the questionnaire card will create a clear entry point before question 1.","acceptanceCriteria":["Add an introduction slide showing hero image, title, subtitle, and a 'Get Started' button","Intro slide must fit within the viewport on desktop and mobile without vertical scrolling","Clicking 'Get Started' advances to question 1","'Back' on question 1 returns to the intro slide","'Start Over' returns to the intro slide, not question 1","Progress bar shows 0% on the intro slide"]}
```

**Issue body format** (replace placeholder from M3):

```markdown
Sent by: {from}

## Issue Context

{context}

## Acceptance Criteria

- {criteria[0]}
- {criteria[1]}

<details><summary>View Original Email</summary>

{text}

</details>
```

**Labels:** `['email-inbox', 'ai-parsed']`

Log `[AI] Requesting Gemini parse` and `[AI] Parse complete` (no body content in logs).
On error: log `[AI Error] Gemini failed to parse structure` + `error.stack`, return 500.

---

### Milestone 5 — Observability Polish

**Goal:** Every execution is fully traceable in Netlify Logs with no PII/secrets.

Audit all `console` calls against the spec:

| Stage               | Level     | Message                                           |
| ------------------- | --------- | ------------------------------------------------- |
| Triggered           | info      | `[Init] Function triggered, to: {to}`             |
| Allowlist pass/fail | info/warn | `[Validation] Sender {from} allowed/rejected`     |
| SPF/DKIM pass/fail  | info/warn | `[Validation] SPF: {val}, DKIM: {val}`            |
| Gemini start        | info      | `[AI] Requesting Gemini parse`                    |
| Gemini done         | info      | `[AI] Parse complete`                             |
| GitHub auth start   | info      | `[Auth] Requesting GitHub App installation token` |
| Issue created       | info      | `[GitHub] Issue created: {url}`                   |
| Any error           | error     | `[X Error] {message}\n{stack}`                    |

**Ensure never logged:** raw `text` body, `GH_PRIVATE_KEY`, `GEMINI_API_KEY`.

---

## Final File Structure

```
email-to-issue/
├── netlify/
│   └── functions/
│       └── inbound-email.ts        ← thin handler only: parse request → call lib → return Response
├── src/
│   └── lib/
│       ├── types.ts                ← shared TS interfaces (EmailPayload, ParsedIssue, Config)
│       ├── parse-email.ts          ← FormData → EmailPayload
│       ├── validate-email.ts       ← EmailPayload + Config → { ok, status }
│       ├── ai.ts                   ← string (email text) → ParsedIssue (Gemini call)
│       └── github.ts               ← EmailPayload + ParsedIssue + Config → IssueResult
├── netlify.toml
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## Environment Variables (`.env.example`)

```
GH_APP_ID=
GH_INSTALLATION_ID=
GH_PRIVATE_KEY=
GH_OWNER=
GH_REPO=
ALLOWED_SENDERS=
INBOUND_EMAIL=
GEMINI_API_KEY=
```

---

## Verification

### Per-milestone

- **M1:** `netlify dev` → `curl -X POST http://localhost:8888/.netlify/functions/inbound-email -F "to=test" -F "from=a@b.com"` → 200
- **M2:** Same curl with unknown sender → 403; with SPF=fail → 401
- **M3:** Valid curl with `GH_*` vars set → issue appears in repo
- **M4:** Valid curl → issue has AI-generated title and formatted body with context + criteria
- **M5:** Netlify function logs show all required stages; grep logs for private key/email body (should 0 results)

### SendGrid Webhook Test

Use SendGrid's "Send Test" from the Inbound Parse dashboard to fire a real webhook at the deployed function URL and confirm an issue is created.
