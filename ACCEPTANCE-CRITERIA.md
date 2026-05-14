# **Acceptance Criteria: Email-to-GitHub Issue Service**

## **Architecture Overview**

This project uses a serverless architecture to bridge email systems with GitHub.

1. **Email Source (e.g., Office 365/Exchange):** An email is sent or forwarded to a specific subdomain address (e.g., new-issues@parse.clhbid.com).
2. **Twilio SendGrid Inbound Parse:** SendGrid receives the email, processes the raw SMTP message, and converts it into a multipart/form-data payload.
3. **Webhook Trigger:** SendGrid makes a POST request containing this payload to the designated Netlify Function URL.
4. **Netlify Function (V2):** The serverless function receives the request, parses the form data using standard Web APIs, and extracts the relevant email fields.
5. **AI Processing (Google Gemini):** The function sends the raw email text to Google's Gemini model using Structured Outputs to extract a guaranteed JSON object containing the context and criteria.
6. **GitHub Authentication:** The function uses a GitHub App Private Key to dynamically request a short-lived Installation Access Token.
7. **GitHub API:** The function uses the @octokit/rest client to create a new issue in the target repository, using the AI-processed details and the original email data.

## **Prerequisites Checklist**

Before the code can be fully tested, the following infrastructure must be configured:

- ![][image1]**Domain Configuration (DNS):**
  - **![][image1]**Create a subdomain specifically for inbound parsing (e.g., parse.clhbid.com).
  - ![][image1]Add an MX record pointing the subdomain to SendGrid (mx.sendgrid.net).
- ![][image1]**Twilio SendGrid Setup:**
  - **![][image1]**Authenticate the subdomain in the SendGrid dashboard.
  - ![][image1]Configure Inbound Parse settings: Add the host/domain and set the Destination URL to the Netlify Function endpoint.
- ![][image1]**GitHub App Creation:**
  - **![][image1]**Create a new GitHub App in your Organization or User settings.
  - ![][image1]**Permissions:** Grant the app Read & write access to "Issues".
  - ![][image1]Disable Webhook events (not needed for this flow).
  - ![][image1]Generate and download a Private Key (RSA .pem file).
  - ![][image1]Install the GitHub App on the target repository.
- ![][image1]**Google AI Studio Setup & Prompt Engineering:**
  - **![][image1]**Obtain a Gemini API Key via Google AI Studio.
  - ![][image1]**Draft System Prompt:** Write a clear instruction for the AI (e.g., "You are a technical product manager. Extract the core issue and actionable acceptance criteria from the following client email...").
  - ![][image1]**Draft Examples (Few-Shot):** Create 1-2 examples of "messy emails" and their ideal structured JSON outputs to feed to the model to ensure consistent formatting.
- ![][image1]**Netlify Environment Setup:**
  - **![][image1]**In the Netlify Site Settings, add the following Environment Variables:
    - GH_APP_ID: (Found in GitHub App settings)
    - GH_INSTALLATION_ID: (Found in the URL after installing the app on your repo)
    - GH_PRIVATE_KEY: (The contents of the .pem file, ensuring formatting is preserved)
    - GH_OWNER: The GitHub organization or username.
    - GH_REPO: The target repository name.
    - ALLOWED_SENDERS: A comma-separated list of approved email addresses.
    - GEMINI_API_KEY: API key generated from Google AI Studio.

## **Architecture Stack**

- **Platform:** Netlify (Functions V2 API)
- **Runtime:** Node.js 22
- **Language:** TypeScript
- **Email Parser:** SendGrid Inbound Parse
- **AI Provider:** Google Gemini (@google/genai SDK)
- **GitHub Authentication:** GitHub App (using @octokit/auth-app)
- **GitHub Client:** @octokit/rest

## **1\. Authentication & Security (GitHub)**

- **Requirement:** The function must authenticate using a GitHub App, not a Personal Access Token (PAT).
- **Requirement:** The authentication strategy must use @octokit/auth-app to generate short-lived Installation Access Tokens.
- **Requirement:** Credentials must be retrieved securely using Netlify's environment variable API (Netlify.env.get()).
- **Required Environment Variables:** GH_APP_ID, GH_PRIVATE_KEY, GH_INSTALLATION_ID.
- **Acceptance State:** The function successfully creates an issue using the identity of the GitHub App (e.g., app-name\[bot\]).

## **2\. Request Handling & Parsing**

- **Requirement:** The function must use the modern Netlify Functions V2 signature (export default async (req: Request, context: Context)).
- **Requirement:** The function must reject non-POST requests with a 405 Method Not Allowed.
- **Requirement:** The function must parse incoming multipart/form-data natively using the standard Web API (await req.formData()). No external parsing libraries are permitted.
- **Requirement:** The function must extract the subject, text, from, to, SPF, and DKIM fields from the SendGrid payload.
- **Acceptance State:** The function successfully extracts email data without throwing parsing errors.

## **3\. Email Security & Sender Validation**

- **Requirement (Sender Allowlist):** The function must check the from address against a predefined list of allowed senders (e.g., parsed from the ALLOWED_SENDERS environment variable).
  - If the sender is not on the list, return a 403 Forbidden response.
- **Requirement (SPF/DKIM Validation):** The function must verify that the incoming email passed SPF and DKIM checks based on SendGrid's payload.
  - If either check indicates a failure or "softfail", exit with a 401 Unauthorized or 403 Forbidden response.
- **Requirement (Destination Verification):** The function must verify the to address matches the expected inbound parse address.
- **Acceptance State:** Emails from unauthorized users or spoofed addresses are rejected before reaching the AI or GitHub APIs.

## **4\. AI Processing (Google Gemini)**

- **Requirement (System Instructions):** The Gemini API call must include a systemInstruction that defines the AI's role and rules for extraction.
- **Requirement (Structured Output):** The function must use the @google/genai SDK to process the email text.
- **Requirement (JSON Schema):** The AI request must enforce a strict JSON response schema via responseSchema containing:
  - context: A string summarizing the core issue or request.
  - acceptanceCriteria: An array of strings representing actionable tasks.
- **Acceptance State:** The function successfully parses the AI response as a typed JSON object without relying on string manipulation or regex.

## **5\. GitHub Issue Creation**

- **Requirement (Issue Formatting):** The function must use @octokit/rest to create the new issue. The body must be formatted in Markdown as follows:
  - A header indicating the sender (Sent by: {from}).
  - An **Issue Context** section using the data extracted by Gemini.
  - An **Acceptance Criteria** section formulated as an unordered list using the array extracted by Gemini.
  - The raw original email body wrapped in a collapsed HTML \<details\> tag (\<details\>\<summary\>View Original Email\</summary\>\\n\\n{original text}\\n\</details\>).
- **Requirement:** The issue title must map to the email subject. If empty, fallback to "New Issue from Email".
- **Requirement:** The issue should include a predefined label (e.g., email-inbox, ai-parsed).
- **Acceptance State:** An issue appears in the target repository containing the structured AI output and the collapsed original email.

## **6\. Observability & Maintainability**

- **Requirement (Lifecycle Logging):** The function must use standard console.info(), console.warn(), and console.error() to trace the execution path in the Netlify Logs. Required log points include:
  - Initialization: Function triggered, including the incoming to address.
  - Validation: Results of the allowlist, SPF, and DKIM checks.
  - External API Calls: Initiation and successful completion of the Gemini request and GitHub issue creation.
- **Requirement (Success Metric):** Upon successful issue creation, the function must log the newly created GitHub Issue URL or Issue Number.
- **Requirement (Data Privacy/Sanitization):** The function **must not** log sensitive data. PII (the raw email body) and secrets (GH_PRIVATE_KEY, GEMINI_API_KEY) must never be written to console outputs.
- **Requirement (Error Context):** When an error occurs, the log must specify the exact stage of failure (e.g., \[Auth Error\] GitHub App Token generation failed or \[AI Error\] Gemini failed to parse structure) alongside the raw error stack trace.
- **Acceptance State:** A developer can view the Netlify Function Logs and trace a request from ingestion to issue creation, easily identifying where a failure occurred without exposing private email contents.

## **7\. Error Handling & Responses**

- **Requirement:** The function must return a standard Web Response object.
- **Requirement:** On successful issue creation, return a 200 OK status with a descriptive message.
- **Requirement:** On failure, return an appropriate HTTP status code to SendGrid (e.g., 401 for auth failures, 403 for allowlist rejections, or 500 for API crashes).
- **Acceptance State:** The function does not crash the Node process on error and handles SendGrid's webhook retries gracefully by returning accurate HTTP statuses.

[image1]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAAAYCAYAAABHuaHbAAABmElEQVR4AezWQQrDMAwEwNL/P7ofSCEmFtYqk2Mw8np02e/HR4AAAQIECBAg0FpAYWu9HuEIECCQIiAnAQKVAgpbpa7ZBAgQIECAAIENAgrbBkQjMgSkJECAAAECqQIKW+rm5CZAgAABAgROCBy5U2E7wu5SAgQIECBAgMB9AYXtvpWTBAgQyBCQkgCBcQIK27iVehABAgQIECAwTUBhm7bRjPdISYAAAQIECCwIKGwLWI4SIECAAAECnQTek0Vhe8+uvZQAAQIECBAIFVDYQhcnNgECGQJSEiBAYIeAwrZD0QwCBAgQIECAQKGAwlaImzFaSgIECBAgQKC7gMLWfUPyESBAgACBBAEZSwUUtlJewwkQIECAAAECzwUUtueGJhAgkCEgJQECBGIFFLbY1QlOgAABAgQIvEVAYeu0aVkIECBAgAABAhcCCtsFil8ECBAgQCBZQPZ5AgrbvJ16EQECBAgQIDBMQGEbtlDPIZAhICUBAgQIrAgobCtazhIgQIAAAQIEDggobH/Q/SZAgAABAgQIdBH4AQAA//8dx+YQAAAABklEQVQDAKDJADE0qd+eAAAAAElFTkSuQmCC
