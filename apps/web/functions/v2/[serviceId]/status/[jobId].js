import { proxyRunpod } from "../../../../_shared/runpod.js";
import { loadAdminState, withCors } from "../../../../_shared/config.js";

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

export async function onRequestGet({ params, env }) {
  const state = await loadAdminState(env);
  const res = await proxyRunpod(env, params.serviceId, `/status/${params.jobId}`, {
    method: "GET",
  }, state);
  return withCors(res);
}
