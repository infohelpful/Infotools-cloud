import { usesEdgeInferenceProxy } from "./config.js";

/**
 * @param {string} apiBase
 * @param {string} serviceId
 * @param {Record<string, unknown>} input
 * @param {import('./types.js').PublicConfig | null} [config]
 */
export async function submitJob(apiBase, serviceId, input, config = null) {
  const base = apiBase.replace(/\/$/, "");
  const path = usesEdgeInferenceProxy(config, serviceId)
    ? `${base}/v2/${encodeURIComponent(serviceId)}/run`
    : `${base}/v2/${encodeURIComponent(serviceId)}/run`;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`job submit failed: ${res.status} ${t}`);
  }
  return res.json();
}

/**
 * @param {string} apiBase
 * @param {string} serviceId
 * @param {string} jobId
 * @param {import('./types.js').PublicConfig | null} [config]
 */
export async function getJobStatus(apiBase, serviceId, jobId, config = null) {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(
    `${base}/v2/${encodeURIComponent(serviceId)}/status/${encodeURIComponent(jobId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return res.json();
}

/**
 * @param {object} opts
 * @param {string} opts.apiBase
 * @param {string} opts.serviceId
 * @param {string} opts.jobId
 * @param {import('./types.js').PublicConfig | null} [opts.config]
 * @param {(status: object) => void} [opts.onTick]
 * @param {number} [opts.intervalMs]
 * @param {number} [opts.timeoutMs]
 */
export async function pollJobUntilDone({
  apiBase,
  serviceId,
  jobId,
  config = null,
  onTick,
  intervalMs = 1500,
  timeoutMs = 30 * 60 * 1000,
}) {
  const started = Date.now();
  for (;;) {
    const status = await getJobStatus(apiBase, serviceId, jobId, config);
    onTick?.(status);
    if (status.status === "COMPLETED") return status;
    if (status.status === "FAILED") {
      throw new Error(status.error || "job failed");
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error("job timeout");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
