/** @typedef {import('./types.js').PublicConfig} PublicConfig */

export const DEFAULT_REWARDED_AD_UNIT = "/22639388115/rewarded_web_example";

/**
 * @param {PublicConfig | null | undefined} config
 * @param {string} serviceId
 * @returns {string | null}
 */
export function resolveRewardedAdUnit(config, serviceId) {
  const services = config?.services;
  if (Array.isArray(services)) {
    const svc = services.find((s) => s.id === serviceId);
    const unit = svc?.rewardedAdUnit?.trim();
    if (unit) return unit;
  }
  const fromMap = config?.rewardedAds?.byService?.[serviceId]?.trim();
  if (fromMap) return fromMap;
  const def = config?.rewardedAds?.default?.trim();
  if (def) return def;
  return null;
}
