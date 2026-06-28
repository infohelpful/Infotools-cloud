import localMock from "./defaults/local.mock.json";
import stagingExample from "./defaults/staging.example.json";
import productionExample from "./defaults/production.example.json";
import registryModule from "./defaults/services.registry.json";

import { decryptAdminSecrets, encryptAdminSecrets } from "./crypto.js";



/** @typedef {import('./types.js').AdminState} AdminState */



export function environmentProfiles() {

  return {

    "local-mock": localMock,

    staging: stagingExample,

    production: productionExample,

  };

}



/** @param {Record<string, unknown> | null | undefined} base @param {Record<string, unknown>} patch */

export function deepMerge(base, patch) {

  if (!patch || typeof patch !== "object") return base || {};

  const out = { ...(base || {}) };

  for (const [key, value] of Object.entries(patch)) {

    if (

      value &&

      typeof value === "object" &&

      !Array.isArray(value) &&

      out[key] &&

      typeof out[key] === "object" &&

      !Array.isArray(out[key])

    ) {

      out[key] = deepMerge(out[key], value);

    } else {

      out[key] = value;

    }

  }

  return out;

}



/** @param {Record<string, unknown> | null | undefined} saved */

export function mergeEnvironmentProfiles(saved) {

  const defaults = environmentProfiles();

  const merged = { ...defaults };

  for (const [id, profile] of Object.entries(saved || {})) {

    merged[id] = deepMerge(defaults[id] || {}, profile);

  }

  return merged;

}



/** @param {Record<string, unknown>} env */

export function defaultAdminState(env) {

  return {

    activeEnvironment: env.INFOTOOLS_ACTIVE_ENV || "production",

    defaultRewardedAdUnit: registryModule.defaultRewardedAdUnit || "",

    adsenseClientId: "",

    adsenseTopSlot: "",

    adsenseBottomSlot: "",

    r2AccountId: "",

    r2S3Endpoint: "",

    r2AccessKeyId: "",

    r2SecretAccessKey: "",

    runpodApiKey: "",

    environments: environmentProfiles(),

    services: registryModule.services,

  };

}



/** @param {Record<string, unknown>} env */

export function adminKvConfigured(env) {

  return Boolean(env.ADMIN_KV);

}



/** @param {Record<string, unknown> | null | undefined} state @param {Record<string, unknown>} [env] */

export function activeProfile(state, env = {}) {

  const envId = state?.activeEnvironment || env.INFOTOOLS_ACTIVE_ENV || "production";

  return (state?.environments || {})[envId] || environmentProfiles()[envId] || {};

}



/** @param {Record<string, unknown>} env */

export async function loadAdminState(env) {

  let state = null;

  if (env.ADMIN_KV) {

    const raw = await env.ADMIN_KV.get("admin-state");

    if (raw) {

      try {

        state = JSON.parse(raw);

      } catch {

        /* fall through */

      }

    }

  }

  if (!state) state = defaultAdminState(env);

  state.environments = mergeEnvironmentProfiles(state.environments);

  return decryptAdminSecrets(state);

}



/** @param {Record<string, unknown>} env @param {AdminState} state */

export async function saveAdminState(env, state) {

  if (!env.ADMIN_KV) return false;

  const encrypted = await encryptAdminSecrets(state);

  await env.ADMIN_KV.put("admin-state", JSON.stringify(encrypted));

  return true;

}



/** @param {AdminState} state */

export function buildRewardedAdsPublic(state) {

  const registry = registryModule;

  const defaultUnit =

    state.defaultRewardedAdUnit?.trim() ||

    registry.defaultRewardedAdUnit?.trim() ||

    "/22639388115/rewarded_web_example";

  const byService = {};

  for (const s of state.services || []) {

    const unit = s.rewardedAdUnit?.trim();

    if (s.id && unit) byService[s.id] = unit;

  }

  return { default: defaultUnit, byService };

}



/** @param {AdminState} state */

export function buildPublicConfig(state) {

  const envId = state.activeEnvironment || "production";

  const profile = (state.environments || {})[envId] || {};

  const services = (state.services || []).filter((s) => s.enabled !== false);

  return {

    activeEnvironment: envId,

    apiBase: profile.apiBase ?? "",

    storage: profile.storage || {},

    inference: profile.inference || {},

    services,

    rewardedAds: buildRewardedAdsPublic(state),

    adsenseClientId: state.adsenseClientId || "",

    adsenseTopSlot: state.adsenseTopSlot || "",

    adsenseBottomSlot: state.adsenseBottomSlot || "",

  };

}



/** @param {Request} request @param {Record<string, unknown>} env */

export function requireAdminAuth(request, env) {

  const token = env.ADMIN_TOKEN;

  if (!token) return null;

  const auth = request.headers.get("Authorization") || "";

  if (auth !== `Bearer ${token}`) {

    return new Response("unauthorized", { status: 401 });

  }

  return null;

}



export function json(data, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: { "Content-Type": "application/json" },

  });

}



export function corsHeaders() {

  return {

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",

    "Access-Control-Allow-Headers": "Content-Type, Authorization",

  };

}



/** @param {Response} response */

export function withCors(response) {

  const headers = new Headers(response.headers);

  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);

  return new Response(response.body, { status: response.status, headers });

}

