/** @param {Record<string, unknown>} env @param {string} serviceId */

export function resolveRunpodEndpoint(env, serviceId) {

  const envKey = `RUNPOD_${serviceId.replace(/-/g, "_").toUpperCase()}_ENDPOINT`;

  if (env[envKey]) return String(env[envKey]).replace(/\/$/, "");

  const mapRaw = env.RUNPOD_ENDPOINTS_JSON;

  if (mapRaw) {

    try {

      const map = JSON.parse(String(mapRaw));

      if (map[serviceId]) return String(map[serviceId]).replace(/\/$/, "");

    } catch {

      /* ignore */

    }

  }

  return "";

}



/** @param {Record<string, unknown>} env @param {Record<string, unknown>} [state] */

export function runpodApiKey(env, state = null) {

  const fromState = typeof state?.runpodApiKey === "string" ? state.runpodApiKey.trim() : "";

  if (fromState) return fromState;

  return String(env.RUNPOD_API_KEY || "");

}



/** @param {Record<string, unknown>} state @param {string} serviceId */

export function resolveRunpodEndpointFromState(state, serviceId) {

  const envId = state?.activeEnvironment || "production";

  const profile = (state?.environments || {})[envId] || {};

  const endpoints = profile?.inference?.endpoints || {};

  if (endpoints[serviceId]) return String(endpoints[serviceId]).replace(/\/$/, "");

  return "";

}



/** @param {Record<string, unknown>} env @param {Record<string, unknown>} [state] @param {string} serviceId */

export function resolveRunpodEndpointMerged(env, state, serviceId) {

  const fromState = state ? resolveRunpodEndpointFromState(state, serviceId) : "";

  if (fromState && !fromState.includes("YOUR_") && !fromState.endsWith("YOUR_ENDPOINT_ID")) {

    return fromState;

  }

  const fromEnv = resolveRunpodEndpoint(env, serviceId);

  if (fromEnv) return fromEnv;

  return fromState;

}



/**

 * @param {Record<string, unknown>} env

 * @param {string} serviceId

 * @param {string} pathSuffix e.g. /run or /status/abc

 * @param {RequestInit} init

 * @param {Record<string, unknown>} [state]

 */

export async function proxyRunpod(env, serviceId, pathSuffix, init, state = null) {

  const endpoint = resolveRunpodEndpointMerged(env, state, serviceId);

  const apiKey = runpodApiKey(env, state);

  if (!endpoint) {

    return new Response(JSON.stringify({ error: `no RunPod endpoint for ${serviceId}` }), {

      status: 503,

      headers: { "Content-Type": "application/json" },

    });

  }

  if (!apiKey) {

    return new Response(JSON.stringify({ error: "RUNPOD_API_KEY not configured" }), {

      status: 503,

      headers: { "Content-Type": "application/json" },

    });

  }

  const url = `${endpoint}${pathSuffix}`;

  const headers = new Headers(init.headers || {});

  headers.set("Authorization", `Bearer ${apiKey}`);

  if (!headers.has("Content-Type") && init.body) {

    headers.set("Content-Type", "application/json");

  }

  const res = await fetch(url, { ...init, headers });

  const text = await res.text();

  return new Response(text, {

    status: res.status,

    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },

  });

}

