import { buildPublicConfig, json, loadAdminState, withCors } from "../../_shared/config.js";

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ env }) {
  const state = await loadAdminState(env);
  return withCors(json(buildPublicConfig(state)));
}
