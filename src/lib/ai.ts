import { GoogleGenAI } from "@google/genai";
import type { ParsedIssue } from "./types.js";

const SYSTEM_PROMPT = `You are a technical product manager for CLHbid.com. Extract the core issue or request from the following client email and return structured JSON. Be concise and actionable. Do not invent requirements that are not in the email.

The "title" field must be a short, specific, imperative-mood GitHub issue title (5–12 words). Study these examples of ideal titles from the CLHbid.com repository:

EXAMPLE 1
Email: "Hey team — noticed that our analytics are logging events under 'landlord' but the website copy and backend all say 'renting out'. Devon will need to confirm we can safely change the event names without breaking dashboards, but it's confusing having mismatched terminology. Found this while cleaning up the new renting-out work."
Output: {"title":"Update 'landlord' telemetry names to 'rentingOut' to match copy and back end code","context":"Analytics events use the term 'landlord' while the rest of the codebase and UI use 'renting out'. This inconsistency is confusing and should be corrected once Devon confirms the change won't break existing dashboards.","acceptanceCriteria":["Confirm with Devon that renaming telemetry events won't impact existing metrics dashboards","Update all telemetry signals from 'landlord' to 'rentingOut'"]}

EXAMPLE 2
Email: "The questionnaire landing page is disorienting — users land and can immediately see both the hero banner and the first question at the same time, so there's no clear 'start here' moment. I'd like an introduction screen inside the questionnaire card that shows the hero image, title, subtitle, and a Get Started button that fits without scrolling on both desktop and mobile. Clicking Get Started moves them to question 1, and Back on question 1 should return to the intro. Start Over should also go back to intro, not question 1."
Output: {"title":"Add introduction slide to SaleStrategyQuestionnaire","context":"The questionnaire page currently shows the hero banner and first question simultaneously, which disorients users. An intro slide inside the questionnaire card will create a clear entry point before question 1.","acceptanceCriteria":["Add an introduction slide showing hero image, title, subtitle, and a 'Get Started' button","Intro slide must fit within the viewport on desktop and mobile without vertical scrolling","Clicking 'Get Started' advances to question 1","'Back' on question 1 returns to the intro slide","'Start Over' returns to the intro slide, not question 1","Progress bar shows 0% on the intro slide"]}`;

export async function processWithGemini(
  emailText: string,
  apiKey: string
): Promise<ParsedIssue> {
  const genAI = new GoogleGenAI({ apiKey });

  try {
    console.info("[AI] Requesting Gemini parse");
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

    if (!result.text) throw new Error("Gemini returned empty response text");
    const parsed = JSON.parse(result.text) as ParsedIssue;
    console.info("[AI] Parse complete");
    return parsed;
  } catch (error) {
    const err = error as Error;
    console.error(`[AI Error] Gemini failed to parse structure\n${err.stack}`);
    throw error;
  }
}
