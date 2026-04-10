import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are Pixel, an AI assistant that edits HTML files for ZING customer websites. You receive the current HTML and a change request. Return ONLY valid JSON in this exact format: { "changes": "plain english description of what you changed", "html": "<complete updated HTML>" }. Make surgical edits only. Preserve all existing styles, scripts, and structure. Never remove sections unless explicitly asked.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function processAiEdit(
  currentHtml: string,
  message: string,
  chatHistory: ChatMessage[]
): Promise<{ changes: string; html: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const msg of chatHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({
    role: "user",
    content: `Here is the current HTML of the website:\n\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nPlease make the following change: ${message}`,
  });

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  return { changes: parsed.changes, html: parsed.html };
}
