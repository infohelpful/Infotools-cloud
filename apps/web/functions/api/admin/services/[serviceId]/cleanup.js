import {
  json,
  loadAdminState,
  requireAdminAuth,
  withCors,
} from "../../../_shared/config.js";
import { deletePrefix, r2Ready } from "../../../_shared/r2.js";

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

export async function onRequestPost({ request, params, env }) {
  const denied = requireAdminAuth(request, env);
  if (denied) return withCors(denied);

  const serviceId = params.serviceId;
  if (!serviceId) return withCors(json({ error: "missing service id" }, 400));

  const state = await loadAdminState(env);
  if (!r2Ready(env, state)) {
    return withCors(json({ error: "R2 not configured" }, 503));
  }

  try {
    const result = await deletePrefix(env, state, `${serviceId}/`);
    return withCors(json(result));
  } catch (err) {
    return withCors(json({ error: String(err) }, 500));
  }
}
