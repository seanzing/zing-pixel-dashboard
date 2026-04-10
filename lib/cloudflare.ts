import fs from "fs";
import path from "path";

const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const SITES_BASE_PATH = process.env.SITES_BASE_PATH!;

export async function createPagesProject(siteId: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: siteId,
        production_branch: "main",
      }),
    }
  );
  return res.json();
}

function getAllFiles(dirPath: string, basePath: string): { path: string; content: Buffer }[] {
  const files: { path: string; content: Buffer }[] = [];
  if (!fs.existsSync(dirPath)) return files;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, basePath));
    } else {
      const relativePath = "/" + path.relative(basePath, fullPath);
      files.push({ path: relativePath, content: fs.readFileSync(fullPath) });
    }
  }
  return files;
}

export async function deployToPages(siteId: string): Promise<string> {
  const siteDir = path.join(SITES_BASE_PATH, siteId);

  const files = getAllFiles(siteDir, siteDir);
  if (files.length === 0) {
    throw new Error(`No files found in ${siteDir}`);
  }

  const formData = new FormData();
  for (const file of files) {
    const blob = new Blob([new Uint8Array(file.content)]);
    formData.append(file.path, blob, file.path);
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${siteId}/deployments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
      },
      body: formData,
    }
  );

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare deploy failed: ${JSON.stringify(data.errors)}`);
  }

  return data.result.url;
}
