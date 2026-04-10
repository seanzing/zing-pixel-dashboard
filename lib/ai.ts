import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are Pixel, an AI assistant that edits HTML files for ZING customer websites. You receive the current HTML and a change request.

Return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "changes": "plain english description of what you changed",
  "replacements": [
    { "find": "exact text to find", "replace": "new text" }
  ]
}

Rules:
- Each "find" value must be an EXACT substring match from the current HTML — copy it verbatim
- Keep "find" strings short and specific — enough context to be unique in the document
- One replacement per distinct change (e.g. phone appears in 3 places → 3 entries if all need updating)
- For structural changes (adding/removing entire sections), include enough surrounding HTML in "find" to uniquely identify the location
- Never return the full HTML — only the replacements
- If a change cannot be made with find/replace, explain why in "changes" and return an empty replacements array`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function processAiEdit(
  currentHtml: string,
  message: string,
  chatHistory: ChatMessage[]
): Promise<{ changes: string; html: string }> {
  // Returns the full updated HTML by applying find/replace patches from AI
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of chatHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({
    role: "user",
    content: `Here is the current HTML of the website:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nPlease make the following change: ${message}`,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Strip markdown code fences if present
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr
      .replace(/^```(?:json)?\s*/i, "")  // strip opening fence
      .replace(/\s*```\s*$/, "");         // strip closing fence
  }

  // Find the outermost JSON object in case there's leading/trailing text
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(jsonStr);

  // Apply find/replace patches to the original HTML
  let updatedHtml = currentHtml;
  const replacements: Array<{ find: string; replace: string }> = parsed.replacements ?? [];
  for (const { find, replace } of replacements) {
    if (find && updatedHtml.includes(find)) {
      updatedHtml = updatedHtml.split(find).join(replace);
    }
  }

  return { changes: parsed.changes, html: updatedHtml };
}
