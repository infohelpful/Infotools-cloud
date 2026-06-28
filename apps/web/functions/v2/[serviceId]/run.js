import { proxyRunpod } from "../../_shared/runpod.js";
import { loadAdminState, withCors } from "../../_shared/config.js";

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

export async function onRequestPost({ request, params, env }) {
  const state = await loadAdminState(env);
  const body = await request.text();
  const res = await proxyRunpod(env, params.serviceId, "/run", {
    method: "POST",
    body,
  }, state);
  return withCors(res);
}
