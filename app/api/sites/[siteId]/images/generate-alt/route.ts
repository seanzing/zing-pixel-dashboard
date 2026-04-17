import { NextRequest } from "next/server";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";

const GITHUB_API = "https://api.github.com";
const REPO = process.env.GITHUB_SITES_REPO!;
const TOKEN = process.env.GITHUB_TOKEN!;

function ghHeaders() {
  return {
    Authorization: `token ${TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ZING-Pixel/1.0",
  };
}

async function getFile(filePath: string) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${filePath}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return { content: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
}

function sse(controller: ReadableStreamDefaultController, event: string, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: NextRequest, { params }: { params: { siteId: string } }) {
  const { siteId } = params;
  const body = await req.json().catch(() => ({})) as { indices?: number[] };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => sse(controller, event, data);

      try {
        const file = await getFile(`${siteId}/index.html`);
        if (!file) { send("error", { message: "Site not found" }); controller.close(); return; }

        const $ = cheerio.load(file.content);
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const allImgs: Array<{ index: number; src: string; previewUrl: string }> = [];
        $("img").each((i, el) => {
          const src = $(el).attr("src") ?? "";
          if (!src || src.startsWith("data:")) return; // skip inline SVGs / data URIs
          const previewUrl = src.startsWith("/")
            ? `https://${siteId}.pages.dev${src}`
            : src.startsWith("http") ? src : `https://${siteId}.pages.dev/${src}`;
          allImgs.push({ index: i, src, previewUrl });
        });

        // If specific indices requested, filter to those only
        const targets = body.indices?.length
          ? allImgs.filter(img => body.indices!.includes(img.index))
          : allImgs;

        send("start", { total: targets.length });

        for (const img of targets) {
          try {
            // Fetch image and convert to base64
            const imgRes = await fetch(img.previewUrl, {
              headers: { "User-Agent": "ZING-Pixel/1.0" },
              signal: AbortSignal.timeout(8000),
            });

            if (!imgRes.ok) {
              send("alt", { index: img.index, alt: "", skipped: true, reason: `HTTP ${imgRes.status}` });
              continue;
            }

            const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
            const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
            const mediaType = validTypes.find(t => contentType.includes(t.split("/")[1])) ?? "image/jpeg";

            const imgBuffer = await imgRes.arrayBuffer();
            const base64 = Buffer.from(imgBuffer).toString("base64");

            // Skip if image is very small (likely an icon or spacer)
            if (imgBuffer.byteLength < 2000) {
              send("alt", { index: img.index, alt: "", skipped: true, reason: "too small" });
              continue;
            }

            const message = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 100,
              messages: [{
                role: "user",
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
                  },
                  {
                    type: "text",
                    text: `Write alt text for this image on a business website.

Rules:
- Describe exactly what's visible — be specific and concrete
- Under 100 characters
- No quotes, no punctuation at the end
- Do NOT start with "A photo of", "An image of", "Image of", or similar
- Just the plain description

Reply with ONLY the alt text, nothing else.`,
                  },
                ],
              }],
            });

            const alt = (message.content[0] as { type: string; text: string }).text
              .trim()
              .replace(/^["']|["']$/g, "")  // strip surrounding quotes
              .replace(/\.$/, "");           // strip trailing period

            send("alt", { index: img.index, alt, src: img.src });
            await new Promise(r => setTimeout(r, 100)); // brief pause between API calls
          } catch (err) {
            send("alt", { index: img.index, alt: "", skipped: true, reason: (err as Error).message.slice(0, 80) });
          }
        }

        send("done", { total: targets.length });
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
