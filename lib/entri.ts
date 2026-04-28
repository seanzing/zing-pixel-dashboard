const ENTRI_API_KEY = process.env.ENTRI_API_KEY ?? '';
const ENTRI_API_BASE = process.env.ENTRI_API_BASE ?? 'https://api.entri.com'; // confirm in meeting

export interface EntriDnsRecord {
  type: 'CNAME' | 'A' | 'TXT' | 'MX';
  host: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface EntriSession {
  sessionId: string;
  connectUrl: string;
}

export interface EntriSessionStatus {
  status: 'pending' | 'completed' | 'failed';
  domain?: string;
  error?: string;
}

/**
 * Create an Entri session for a domain with the desired DNS records.
 * Entri will guide the customer to set exactly these records at their registrar.
 */
export async function createEntriSession(
  domain: string,
  records: EntriDnsRecord[]
): Promise<EntriSession> {
  if (!ENTRI_API_KEY) {
    console.warn('[entri] ENTRI_API_KEY not set — returning stub session');
    return {
      sessionId: `stub-${Date.now()}`,
      connectUrl: `https://entri.com/connect/stub-preview?domain=${encodeURIComponent(domain)}`,
    };
  }

  // TODO: confirm exact endpoint + payload shape in tomorrow's meeting
  const res = await fetch(`${ENTRI_API_BASE}/v1/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ENTRI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ domain, dnsRecords: records }),
  });

  if (!res.ok) throw new Error(`Entri session creation failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  return {
    sessionId: data.sessionId ?? data.id,
    connectUrl: data.connectUrl ?? data.url,
  };
}

/**
 * Poll Entri session status (fallback if webhook is missed).
 */
export async function getEntriSessionStatus(sessionId: string): Promise<EntriSessionStatus> {
  if (!ENTRI_API_KEY || sessionId.startsWith('stub-')) {
    return { status: 'pending' };
  }

  const res = await fetch(`${ENTRI_API_BASE}/v1/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${ENTRI_API_KEY}` },
  });

  if (!res.ok) throw new Error(`Entri status check failed: ${res.status}`);
  const data = await res.json();
  return { status: data.status, domain: data.domain, error: data.error };
}
