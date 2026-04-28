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

// ── Zone-level functions (for custom domain publishing flow) ──────────────

/** Create a Cloudflare zone for a domain. jump_start=true auto-imports existing DNS. */
export async function createCfZone(domain: string): Promise<{
  zoneId: string;
  nameservers: string[];
  status: string;
}> {
  const res = await fetch("https://api.cloudflare.com/client/v4/zones", {
    method: "POST",
    headers: cfHeaders(),
    body: JSON.stringify({
      name: domain,
      account: { id: CF_ACCOUNT_ID },
      jump_start: true,
    }),
  });
  const data = await res.json();

  if (!data.success) {
    const code = data.errors?.[0]?.code;
    // Zone already exists — look it up instead
    if (code === 1061 || code === 1049) {
      const existingId = await findZoneByDomain(domain);
      if (existingId) {
        const status = await getZoneStatus(existingId);
        return { zoneId: existingId, nameservers: status.nameServers, status: status.status };
      }
    }
    throw new Error(data.errors?.[0]?.message ?? "Failed to create zone");
  }

  const zone = data.result;
  return {
    zoneId: zone.id,
    nameservers: zone.name_servers ?? [],
    status: zone.status,
  };
}

/** Get all DNS records for a zone (imported + manually added). */
export async function getZoneDnsRecords(zoneId: string): Promise<Array<{
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
  ttl: number;
  proxied?: boolean;
}>> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=100`,
    { headers: cfHeaders() }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? "Failed to fetch DNS records");
  return (data.result ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    type: r.type as string,
    name: r.name as string,
    content: r.content as string,
    priority: r.priority as number | undefined,
    ttl: r.ttl as number,
    proxied: r.proxied as boolean | undefined,
  }));
}

/** Add a DNS record to a zone. */
export async function addZoneDnsRecord(zoneId: string, record: {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}): Promise<{ id: string }> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: cfHeaders(),
      body: JSON.stringify(record),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? "Failed to add DNS record");
  return { id: data.result.id };
}

/** Update an existing DNS record. */
export async function updateZoneDnsRecord(zoneId: string, recordId: string, record: {
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "PUT",
      headers: cfHeaders(),
      body: JSON.stringify(record),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? "Failed to update DNS record");
}

/** Get zone status and nameservers. */
export async function getZoneStatus(zoneId: string): Promise<{
  status: string;
  nameServers: string[];
}> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
    { headers: cfHeaders() }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? "Failed to get zone status");
  return {
    status: data.result.status,
    nameServers: data.result.name_servers ?? [],
  };
}

/** Look up a zone by domain name. Returns zoneId or null. */
export async function findZoneByDomain(domain: string): Promise<string | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(domain)}`,
    { headers: cfHeaders() }
  );
  const data = await res.json();
  if (!data.success || !data.result?.length) return null;
  return data.result[0].id;
}

/** Delete a zone (cleanup if publishing is cancelled). */
export async function deleteCfZone(zoneId: string): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
    { method: "DELETE", headers: cfHeaders() }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? "Failed to delete zone");
}
