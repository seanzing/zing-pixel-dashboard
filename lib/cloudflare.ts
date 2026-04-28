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

/**
 * Register a custom domain on a CF Pages project.
 * CF Pages will verify by checking for a CNAME pointing to {projectName}.pages.dev
 * and then provision SSL automatically.
 */
export async function addCfPagesCustomDomain(
  projectName: string,
  domain: string
): Promise<{ domain: string; status: string }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${projectName}/domains`,
    {
      method: "POST",
      headers: cfHeaders(),
      body: JSON.stringify({ name: domain }),
    }
  );
  const data = await res.json();

  // 409 = domain already added — treat as success
  if (!data.success && res.status !== 409) {
    throw new Error(data.errors?.[0]?.message ?? `CF Pages domain add failed: ${res.status}`);
  }

  if (res.status === 409) {
    // Fetch current status instead
    const current = await getCfPagesCustomDomainStatus(projectName, domain);
    return current ?? { domain, status: "initializing" };
  }

  return { domain: data.result?.name ?? domain, status: data.result?.status ?? "initializing" };
}

/**
 * Get the current status of a custom domain on a CF Pages project.
 * Status values: 'initializing' | 'pending_verification' | 'pending_blocked' | 'active' | 'deactivated' | 'error'
 */
export async function getCfPagesCustomDomainStatus(
  projectName: string,
  domain: string
): Promise<{ status: string; domain: string } | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${projectName}/domains/${encodeURIComponent(domain)}`,
    { headers: cfHeaders() }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.success) return null;
  return { status: data.result?.status, domain: data.result?.name };
}

/**
 * Remove a custom domain from a CF Pages project.
 */
export async function removeCfPagesCustomDomain(
  projectName: string,
  domain: string
): Promise<void> {
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${projectName}/domains/${encodeURIComponent(domain)}`,
    { method: "DELETE", headers: cfHeaders() }
  );
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
