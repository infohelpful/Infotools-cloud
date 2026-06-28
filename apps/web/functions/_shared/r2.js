import { AwsClient } from "aws4fetch";
import { activeProfile } from "./config.js";

/** @param {Record<string, unknown>} env @param {Record<string, unknown>} [state] */
export function resolveR2Config(env, state = null) {
  const profile = activeProfile(state, env);
  const storage = profile?.storage || {};

  const accountId = String(state?.r2AccountId || env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = String(state?.r2AccessKeyId || env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(state?.r2SecretAccessKey || env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = String(storage.bucket || env.R2_BUCKET || "").trim();
  const publicBaseUrl = String(storage.publicBaseUrl || env.R2_PUBLIC_BASE_URL || "").trim();
  let s3Endpoint = String(state?.r2S3Endpoint || "").trim();
  if (!s3Endpoint && accountId) {
    s3Endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    s3Endpoint,
  };
}

/** @param {Record<string, unknown>} env @param {Record<string, unknown>} [state] */
export function r2Ready(env, state = null) {
  const cfg = resolveR2Config(env, state);
  return Boolean(cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket && cfg.s3Endpoint);
}

/** @param {ReturnType<typeof resolveR2Config>} cfg */
function getR2Client(cfg) {
  if (!cfg.accessKeyId || !cfg.secretAccessKey) return null;
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
  });
}

/** @param {ReturnType<typeof resolveR2Config>} cfg */
function objectBaseUrl(cfg) {
  return `${cfg.s3Endpoint.replace(/\/$/, "")}/${cfg.bucket}`;
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} [state]
 * @param {string} key
 * @param {string} contentType
 * @param {number} [expiresSec]
 */
export async function presignPut(env, state, key, contentType, expiresSec = 3600) {
  const cfg = resolveR2Config(env, state);
  const client = getR2Client(cfg);
  if (!client || !r2Ready(env, state)) throw new Error("R2 credentials not configured");
  const url = new URL(`${objectBaseUrl(cfg)}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": contentType },
    aws: { signQuery: true },
  });
  return signed.url;
}

/** @param {Record<string, unknown>} env @param {string} key @param {string} [publicBaseUrl] */
export function publicObjectUrl(env, key, publicBaseUrl) {
  const base = publicBaseUrl || env.R2_PUBLIC_BASE_URL || "";
  if (base) return `${String(base).replace(/\/$/, "")}/${key}`;
  return `/api/storage/object/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} [state]
 * @param {string} key
 * @param {BodyInit} body
 * @param {string} contentType
 */
export async function putObject(env, state, key, body, contentType) {
  const cfg = resolveR2Config(env, state);
  const client = getR2Client(cfg);
  if (!client || !r2Ready(env, state)) throw new Error("R2 credentials not configured");
  const url = `${objectBaseUrl(cfg)}/${key}`;
  const signed = await client.sign(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
  });
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`R2 put failed: ${res.status} ${t}`);
  }
}

/** @param {Record<string, unknown>} env @param {Record<string, unknown>} [state] @param {string} key */
export async function getObject(env, state, key) {
  const cfg = resolveR2Config(env, state);
  const client = getR2Client(cfg);
  if (!client || !r2Ready(env, state)) throw new Error("R2 credentials not configured");
  const url = `${objectBaseUrl(cfg)}/${key}`;
  const signed = await client.sign(url, { method: "GET" });
  const res = await fetch(signed.url, { method: "GET", headers: signed.headers });
  if (!res.ok) throw new Error(`R2 get failed: ${res.status}`);
  return res;
}

/** @param {Record<string, unknown>} env @param {Record<string, unknown>} [state] @param {string} key */
export async function deleteObject(env, state, key) {
  const cfg = resolveR2Config(env, state);
  const client = getR2Client(cfg);
  if (!client || !r2Ready(env, state)) throw new Error("R2 credentials not configured");
  const url = `${objectBaseUrl(cfg)}/${key}`;
  const signed = await client.sign(url, { method: "DELETE" });
  const res = await fetch(signed.url, { method: "DELETE", headers: signed.headers });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`R2 delete failed: ${res.status} ${t}`);
  }
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} [state]
 * @param {string} prefix
 */
export async function listObjectsWithMeta(env, state, prefix) {
  const cfg = resolveR2Config(env, state);
  const client = getR2Client(cfg);
  if (!client || !r2Ready(env, state)) throw new Error("R2 credentials not configured");

  const items = [];
  let continuationToken = "";

  do {
    const url = new URL(objectBaseUrl(cfg));
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (continuationToken) url.searchParams.set("continuation-token", continuationToken);

    const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
    const res = await fetch(signed.url, { method: "GET", headers: signed.headers });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`R2 list failed: ${res.status} ${t}`);
    }

    const xml = await res.text();
    const blocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
    for (const block of blocks) {
      const keyMatch = block.match(/<Key>([^<]+)<\/Key>/);
      const sizeMatch = block.match(/<Size>(\d+)<\/Size>/);
      if (keyMatch) {
        items.push({
          key: keyMatch[1],
          size: sizeMatch ? Number(sizeMatch[1]) : 0,
        });
      }
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    continuationToken = truncated && tokenMatch ? tokenMatch[1] : "";
  } while (continuationToken);

  return items;
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} [state]
 * @param {string} prefix
 */
export async function deletePrefix(env, state, prefix) {
  const items = await listObjectsWithMeta(env, state, prefix);
  let deleted = 0;
  let freedBytes = 0;
  for (const item of items) {
    await deleteObject(env, state, item.key);
    deleted += 1;
    freedBytes += item.size || 0;
  }
  return { deleted, freedBytes };
}
