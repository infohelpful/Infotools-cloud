import { json, loadAdminState, withCors, buildPublicConfig } from "../../_shared/config.js";
import { presignPut, publicObjectUrl, r2Ready } from "../../_shared/r2.js";

function safeKeyPart(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function onRequestOptions() {
  return withCors(new Response(null, { status: 204 }));
}

/** JSON presign: { filename, prefix, contentType } */
export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    const state = await loadAdminState(env);
    if (!r2Ready(env, state)) {
      return withCors(json({ error: "R2 not configured on edge" }, 503));
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(json({ error: "invalid json" }, 400));
    }
    const prefix = safeKeyPart(body.prefix || "uploads").replace(/\/$/, "");
    const filename = safeKeyPart(body.filename || "upload.bin");
    const key = `${prefix}/${crypto.randomUUID().replace(/-/g, "")}-${filename}`;
    const ct = body.contentType || "application/octet-stream";
    const uploadUrl = await presignPut(env, state, key, ct);
    const pub = buildPublicConfig(state);
    const publicUrl = publicObjectUrl(env, key, pub.storage?.publicBaseUrl);
    return withCors(
      json({
        key,
        uploadUrl,
        url: publicUrl,
        publicUrl,
        mode: "presigned",
      }),
    );
  }

  return withCors(
    json(
      {
        error:
          "multipart upload not supported on edge; send JSON { filename, prefix, contentType } for presigned PUT",
      },
      415,
    ),
  );
}
