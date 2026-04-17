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

/** Custom error thrown when a write conflicts with a concurrent edit (stale SHA). */
export class StaleShaError extends Error {
  constructor(path: string) {
    super(`Concurrent edit conflict: ${path} was modified by another user. Reload to get the latest version.`);
    this.name = "StaleShaError";
  }
}

/** Write (create or update) a file in the repo. Returns the commit SHA.
 *  Throws StaleShaError when GitHub returns 409 (stale SHA / concurrent edit). */
export async function writeFile(
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<string> {
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

  if (res.status === 409 || res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { message?: string }).message ?? "";
    // GitHub returns 422 with "does not match" when SHA is stale
    if (res.status === 409 || msg.includes("does not match") || msg.includes("SHA")) {
      throw new StaleShaError(path);
    }
    throw new Error(`GitHub PUT ${path}: ${res.status} ${msg}`);
  }

  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.commit?.sha ?? "";
}

/** Check if a directory exists by listing its contents. */
export async function directoryExists(path: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${path}`, {
    headers: headers(),
  });
  return res.ok;
}

/** List top-level directory names in the repo root. */
export async function listRootDirectories(): Promise<string[]> {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/`, {
    headers: headers(),
    next: { revalidate: 0 },
  } as RequestInit);
  if (!res.ok) return [];
  const data: Array<{ name: string; type: string }> = await res.json();
  return data.filter((item) => item.type === "dir").map((item) => item.name);
}
