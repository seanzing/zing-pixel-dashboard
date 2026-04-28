/**
 * CF Pages Direct Deploy
 *
 * Deploys a site directly to Cloudflare Pages via the REST API,
 * bypassing GitHub Actions. Used as a parallel fast-path alongside
 * the GitHub Actions deploy triggered by the git commit.
 *
 * Flow:
 *  1. Fetch all site files from GitHub (raw CDN — no auth, no rate limits)
 *  2. Apply the in-memory changed file(s) without re-fetching them
 *  3. Create a CF Pages deployment via the Wrangler-compatible upload API
 *  4. Upload only new/changed file hashes (CF deduplicates by content hash)
 *  5. Finalize the deployment
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const GITHUB_RAW = "https://raw.githubusercontent.com";
const CF_API = "https://api.cloudflare.com/client/v4";

function cfHeaders() {
  return {
    Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

interface FileChange {
  page: string;   // relative path within site, e.g. "index.html"
  content: string; // new HTML content
}

/**
 * Fetch all file paths for a site from GitHub using the tree API.
 * Returns list of { path, sha } relative to the repo root.
 */
async function getSiteTree(
  repo: string,
  siteId: string,
  githubToken: string
): Promise<Array<{ path: string; sha: string; size: number }>> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,
    {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );
  if (!res.ok) throw new Error(`GitHub tree API failed: ${res.status}`);
  const data = await res.json();
  return (data.tree ?? []).filter(
    (f: { type: string; path: string }) =>
      f.type === "blob" && f.path.startsWith(`${siteId}/`)
  );
}

/**
 * Download all site files to a temp directory.
 * Uses raw.githubusercontent.com (fast CDN, no auth needed for public repos).
 * For changed files, uses the in-memory content instead.
 */
async function fetchSiteToDir(
  repo: string,
  siteId: string,
  githubToken: string,
  changes: FileChange[],
  tmpDir: string
): Promise<void> {
  const tree = await getSiteTree(repo, siteId, githubToken);
  const changeMap = new Map(changes.map((c) => [c.page, c.content]));

  const CONCURRENCY = 20;
  for (let i = 0; i < tree.length; i += CONCURRENCY) {
    const batch = tree.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (file) => {
        const relativePath = file.path.slice(siteId.length + 1); // strip "siteId/"
        const localPath = path.join(tmpDir, relativePath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });

        const changedContent = changeMap.get(relativePath);
        if (changedContent !== undefined) {
          fs.writeFileSync(localPath, changedContent, "utf8");
          return;
        }

        // Fetch from GitHub raw CDN (public repo — no auth required, very fast)
        const url = `${GITHUB_RAW}/${repo}/main/${file.path}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`[cf-deploy] Failed to fetch ${file.path}: ${res.status}`);
          return;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(localPath, buf);
      })
    );
  }
}

/**
 * Ensure the CF Pages project exists with production_branch=main.
 */
async function ensureProject(accountId: string, siteId: string): Promise<void> {
  await fetch(`${CF_API}/accounts/${accountId}/pages/projects`, {
    method: "POST",
    headers: cfHeaders(),
    body: JSON.stringify({ name: siteId, production_branch: "main" }),
  });
  // Ignore errors — project may already exist
}

/**
 * Provision {siteId}.zingsite.com as a custom domain on the CF Pages project.
 * Idempotent — safe to call even if the domain is already active.
 */
async function provisionZingsiteDomain(
  accountId: string,
  siteId: string
): Promise<void> {
  await fetch(
    `${CF_API}/accounts/${accountId}/pages/projects/${siteId}/domains`,
    {
      method: "POST",
      headers: cfHeaders(),
      body: JSON.stringify({ name: `${siteId}.zingsite.com` }),
    }
  );
  // Ignore errors — domain may already be active
}

/**
 * Run `wrangler pages deploy` on the temp directory.
 * Returns the deployment URL.
 */
async function wranglerDeploy(
  siteId: string,
  tmpDir: string,
  accountId: string,
  apiToken: string
): Promise<string> {
  // wrangler is added as a package dep — use npx to find it
  const { stdout } = await execFileAsync(
    "npx",
    [
      "wrangler",
      "pages",
      "deploy",
      tmpDir,
      "--project-name",
      siteId,
      "--branch",
      "main",
      "--commit-dirty=true",
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: apiToken,
        CLOUDFLARE_ACCOUNT_ID: accountId,
      },
      timeout: 180_000, // 3 min max
    }
  );

  // Extract deployment URL from wrangler output
  const match = stdout.match(/https:\/\/[a-f0-9]+\.[^.]+\.pages\.dev/);
  return match ? match[0] : `https://${siteId}.pages.dev`;
}

/**
 * Main export: deploy a site to CF Pages directly.
 *
 * @param siteId  - CF Pages project name (e.g. "mooreroofing")
 * @param changes - Array of { page, content } for files being updated
 * @returns { ok, url, error }
 */
export async function cfPagesDeploy(
  siteId: string,
  changes: FileChange[]
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_SITES_REPO; // e.g. "seanzing/zing-sites"

  if (!accountId || !apiToken || !githubToken || !repo) {
    return { ok: false, error: "Missing CF or GitHub env vars for direct deploy" };
  }

  // Validate siteId — prevent path traversal in CF API URLs and domain provisioning
  if (!/^[a-z0-9][a-z0-9-]*$/.test(siteId)) {
    return { ok: false, error: "Invalid siteId format" };
  }

  const tmpDir = path.join(os.tmpdir(), `pixel-cf-${siteId}-${Date.now()}`);

  try {
    // Ensure CF Pages project exists
    await ensureProject(accountId, siteId);

    // Fetch all site files to temp dir, applying in-memory changes
    await fetchSiteToDir(repo, siteId, githubToken, changes, tmpDir);

    // Run wrangler to deploy
    const url = await wranglerDeploy(siteId, tmpDir, accountId, apiToken);

    // Provision zingsite.com subdomain (idempotent)
    await provisionZingsiteDomain(accountId, siteId);

    return { ok: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cf-deploy] ${siteId}: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}
