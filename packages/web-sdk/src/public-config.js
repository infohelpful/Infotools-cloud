/**
 * @param {string} baseUrl
 * @returns {Promise<import('./types.js').PublicConfig>}
 */
export async function fetchPublicConfig(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/config/public`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
  return res.json();
}
