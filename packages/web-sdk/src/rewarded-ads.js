/** @typedef {import('./types.js').PublicConfig} PublicConfig */

export const DEFAULT_REWARDED_AD_UNIT = "/22639388115/rewarded_web_example";

/**
 * @param {PublicConfig | null | undefined} config
 * @param {string} serviceId
 * @returns {string | null}
 */
export function resolveRewardedAdUnit(config, serviceId) {
  // 1. 로컬 환경(localhost) 또는 활성 환경이 운영(production)이 아닌 경우 안전하게 구글 테스트 보상형 광고 ID 반환
  const isLocal = typeof window !== "undefined" && 
    (window.location.hostname === "localhost" || 
     window.location.hostname === "127.0.0.1" || 
     window.location.hostname === "");
     
  if (isLocal || config?.activeEnvironment !== "production") {
    return DEFAULT_REWARDED_AD_UNIT;
  }

  // 2. 운영 환경일 때는 관리자 페이지에서 설정한 실제 ID 사용
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
