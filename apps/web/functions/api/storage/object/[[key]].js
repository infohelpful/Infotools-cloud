import { loadAdminState } from "../../../_shared/config.js";
import { getObject, r2Ready } from "../../../_shared/r2.js";

export async function onRequestGet({ params, env }) {
  const key = params.key;
  if (!key) return new Response("not found", { status: 404 });

  const state = await loadAdminState(env);
  if (!r2Ready(env, state)) {
    return new Response("R2 not configured", { status: 503 });
  }

  try {
    const res = await getObject(env, state, key);
    const headers = new Headers();
    const ct = res.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    headers.set("Cache-Control", "public, max-age=3600");
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    return new Response(String(err), { status: 404 });
  }
}
