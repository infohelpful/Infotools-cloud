import {
  adminKvConfigured,
  deepMerge,
  json,
  loadAdminState,
  mergeEnvironmentProfiles,
  requireAdminAuth,
  saveAdminState,
  withCors,
} from "../../_shared/config.js";

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ request, env }) {
  const denied = requireAdminAuth(request, env);
  if (denied) return withCors(denied);

  const state = await loadAdminState(env);
  return withCors(
    json({
      ...state,
      meta: {
        kvConfigured: adminKvConfigured(env),
        persistEnabled: adminKvConfigured(env),
      },
    }),
  );
}

export async function onRequestPost({ request, env }) {
  const denied = requireAdminAuth(request, env);
  if (denied) return withCors(denied);

  if (!adminKvConfigured(env)) {
    return withCors(
      json(
        {
          error:
            "ADMIN_KV is not configured. Create a KV namespace, bind it as ADMIN_KV in wrangler.toml, and redeploy.",
        },
        503,
      ),
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(json({ error: "invalid json" }, 400));
  }

  const state = await loadAdminState(env);
  if (body.activeEnvironment) state.activeEnvironment = body.activeEnvironment;
  if (typeof body.defaultRewardedAdUnit === "string") {
    state.defaultRewardedAdUnit = body.defaultRewardedAdUnit;
  }
  if (typeof body.adsenseClientId === "string") state.adsenseClientId = body.adsenseClientId;
  if (typeof body.adsenseTopSlot === "string") state.adsenseTopSlot = body.adsenseTopSlot;
  if (typeof body.adsenseBottomSlot === "string") state.adsenseBottomSlot = body.adsenseBottomSlot;
  if (typeof body.r2AccountId === "string") state.r2AccountId = body.r2AccountId;
  if (typeof body.r2S3Endpoint === "string") state.r2S3Endpoint = body.r2S3Endpoint;
  if (typeof body.r2AccessKeyId === "string") state.r2AccessKeyId = body.r2AccessKeyId;
  if (typeof body.r2SecretAccessKey === "string") state.r2SecretAccessKey = body.r2SecretAccessKey;
  if (typeof body.runpodApiKey === "string") state.runpodApiKey = body.runpodApiKey;
  if (Array.isArray(body.services)) state.services = body.services;
  if (body.environments && typeof body.environments === "object") {
    state.environments = mergeEnvironmentProfiles(
      deepMerge(state.environments || {}, body.environments),
    );
  }

  const saved = await saveAdminState(env, state);
  if (!saved) {
    return withCors(json({ error: "failed to persist admin state" }, 500));
  }

  return withCors(
    json({
      ...state,
      meta: {
        kvConfigured: true,
        persistEnabled: true,
      },
    }),
  );
}
