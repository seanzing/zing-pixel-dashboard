export const WORKER_URL = process.env.MIGRATION_WORKER_URL!;
export const MIGRATION_SECRET = process.env.MIGRATION_SECRET!;

export function workerFetch(path: string, options?: RequestInit) {
  return fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...options?.headers,
      'X-Migration-Secret': MIGRATION_SECRET,
      'Content-Type': 'application/json',
    },
  });
}
