const GITHUB_API = "https://api.github.com";
const REPO = process.env.GITHUB_SITES_REPO!;
const TOKEN = process.env.GITHUB_TOKEN!;

function headers() {
  return {
    Authorization: `token ${TOKEN}`,
    Accept: "application/vnd.github.v3+json",
  };
}

/** Get a file from the repo. Returns decoded content and sha for updates. */
export async function getFile(
  path: string
): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, {
    headers: headers(),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha };
}

/** Write (create or update) a file in the repo. Commits with the given message. */
export async function writeFile(
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<void> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
}

/** Check if a directory exists by listing its contents. */
export async function directoryExists(path: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, {
    headers: headers(),
  });
  return res.ok;
}
