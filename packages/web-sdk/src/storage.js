/**
 * @param {string} apiBase
 * @param {File} file
 * @param {string} prefix
 * @param {import('./types.js').PublicConfig | null} [config]
 */
export async function uploadFile(apiBase, file, prefix = "uploads", config = null) {
  const provider = config?.storage?.provider;
  const mode = config?.storage?.mode;

  if (provider === "r2" || mode === "presigned") {
    return uploadFilePresigned(apiBase, file, prefix, config);
  }

  const fd = new FormData();
  fd.append("file", file);
  const url = `${apiBase.replace(/\/$/, "")}/api/storage/upload?prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { method: "POST", body: fd });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`upload failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return {
    key: data.key,
    url: data.url?.startsWith("http")
      ? data.url
      : `${apiBase.replace(/\/$/, "")}${data.url}`,
    size: data.size ?? file.size,
  };
}

/**
 * @param {string} apiBase
 * @param {File} file
 * @param {string} prefix
 * @param {import('./types.js').PublicConfig | null} [config]
 */
async function uploadFilePresigned(apiBase, file, prefix, config) {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/api/storage/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      prefix,
      contentType: file.type || "application/octet-stream",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`presign failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  const putRes = await fetch(data.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`R2 upload failed: ${putRes.status} ${t}`);
  }
  const publicUrl = data.publicUrl || data.url;
  return {
    key: data.key,
    url: publicUrl?.startsWith("http") ? publicUrl : `${base}${publicUrl}`,
    size: file.size,
  };
}
