const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;

function cfHeaders() {
  return {
    Authorization: `Bearer ${CF_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function createPagesProject(siteId: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
    {
      method: "POST",
      headers: cfHeaders(),
      body: JSON.stringify({ name: siteId, production_branch: "main" }),
    }
  );
  return res.json();
}

export async function addCustomDomain(siteId: string, domain: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${siteId}/domains`,
    {
      method: "POST",
      headers: cfHeaders(),
      body: JSON.stringify({ name: domain }),
    }
  );
  return res.json();
}

export async function getCustomDomains(siteId: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${siteId}/domains`,
    { headers: cfHeaders() }
  );
  return res.json();
}

export async function removeCustomDomain(siteId: string, domain: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${siteId}/domains/${encodeURIComponent(domain)}`,
    { method: "DELETE", headers: cfHeaders() }
  );
  return res.json();
}

// Patch a Pages project's deployment configs (e.g. to set aliases)
export async function patchPagesProject(siteId: string, patch: Record<string, unknown>) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${siteId}`,
    {
      method: "PATCH",
      headers: cfHeaders(),
      body: JSON.stringify(patch),
    }
  );
  return res.json();
}
