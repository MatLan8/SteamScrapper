const DEFAULT_BASE = "http://localhost:3001";

export function getApiBase(): string {
  return import.meta.env.VITE_API_BASE ?? DEFAULT_BASE;
}

export async function postJson<T>(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: (data as { error?: string }).error ?? res.statusText,
      status: res.status,
    };
  }
  return { ok: true, data: data as T, status: res.status };
}

export async function getJob(jobId: string) {
  const base = getApiBase();
  const res = await fetch(`${base}/api/jobs/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}
