/**
 * @param {import('./types.js').PublicConfig | null | undefined} config
 * @param {string} [fallback]
 */
export function resolveApiBase(config, fallback = "http://127.0.0.1:19427") {
  if (config && Object.prototype.hasOwnProperty.call(config, "apiBase")) {
    const base = config.apiBase;
    if (base === "" || base === null || base === undefined) {
      if (typeof globalThis !== "undefined" && globalThis.location?.origin) {
        return globalThis.location.origin.replace(/\/$/, "");
      }
      return fallback.replace(/\/$/, "");
    }
    return String(base).replace(/\/$/, "");
  }

  const storage = config?.storage;
  const inference = config?.inference;
  return (
    inference?.baseUrl ||
    storage?.baseUrl ||
    import.meta.env?.VITE_API_BASE_URL ||
    fallback
  ).replace(/\/$/, "");
}

/**
 * @param {import('./types.js').PublicConfig | null | undefined} config
 * @param {string} serviceId
 */
export function usesEdgeInferenceProxy(config, serviceId) {
  const inf = config?.inference;
  if (!inf) return false;
  if (inf.provider === "mock-runpod" || inf.mode === "direct") return false;
  if (inf.mode === "edge-proxy" || inf.provider === "runpod") return true;
  return Boolean(inf.endpoints?.[serviceId]);
}
