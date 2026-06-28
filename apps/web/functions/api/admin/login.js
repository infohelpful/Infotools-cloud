import { json, withCors } from "../../_shared/config.js";

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return withCors(json({ error: "invalid json" }, 400));
  }

  const username = body.username || "";
  const password = body.password || "";

  const envUser = env.ADMIN_USERNAME;
  const envPassword = env.ADMIN_PASSWORD;
  const productionMode = String(env.INFOTOOLS_ACTIVE_ENV || "").toLowerCase() === "production";

  if (productionMode && (!envUser || !envPassword || !env.ADMIN_TOKEN)) {
    return withCors(
      json(
        {
          error:
            "Admin login requires ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_TOKEN secrets in production",
        },
        503,
      ),
    );
  }

  const expectedUser = (envUser || "infohelpful").trim();
  const expectedPassword = (envPassword || "EP3.0mg,").trim();

  if (username === expectedUser && password === expectedPassword) {
    const token = env.ADMIN_TOKEN || "mock-admin-token-12345";
    return withCors(json({ token }));
  }

  return withCors(json({ error: "invalid credentials" }, 401));
}
