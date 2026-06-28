/**
 * InfoTools Cloud — 보상형 광고 공통 바인딩
 *
 * @example
 * import { bindRewardedAction } from "@infotools/rewarded-ads";
 * import { resolveRewardedAdUnit } from "@infotools/web-sdk";
 *
 * bindRewardedAction({
 *   serviceId: "vocal-remover",
 *   button: btnAnalyze,
 *   actionLabel: "무료 분석하기 ( 30초 광고 시청 )",
 *   canRun: () => !!selectedFile && btnAnalyze.dataset.busy !== "1",
 *   getAdUnitPath: () => resolveRewardedAdUnit(publicConfig, "vocal-remover"),
 *   onReward: () => runAnalysis(),
 * });
 */

import {
  configureGptRewardedAds,
  initGptRewardedAds,
  requestRewardedAd,
} from "./gpt-engine.js";
import { installGlobals, showSiteAlert } from "./site-modal.js";

const DEFAULT_LOADING_LABEL = "광고 준비 중…";
const SAFETY_MS = 16_000;

/** @param {string | null | undefined} path */
function normalizeAdUnit(path) {
  const p = String(path || "").trim();
  return p || null;
}

function shouldSkipRewardedAd() {
  return new URLSearchParams(window.location.search).get("skip_ad") === "1";
}

/**
 * @param {{
 *   serviceId: string,
 *   button: HTMLButtonElement | null,
 *   onReward: () => void | Promise<void>,
 *   getAdUnitPath?: () => string | null | undefined,
 *   actionLabel?: string,
 *   loadingLabel?: string,
 *   canRun?: () => boolean,
 *   prefetch?: boolean,
 *   safetyTimeoutMs?: number,
 *   onLoadingChange?: (loading: boolean) => void,
 * }} opts
 */
export function bindRewardedAction(opts) {
  installGlobals();

  const button = opts.button;
  const actionLabel = opts.actionLabel || button?.textContent?.trim() || "계속";
  const loadingLabel = opts.loadingLabel || DEFAULT_LOADING_LABEL;
  const prefetch = opts.prefetch !== false;
  const safetyMs = opts.safetyTimeoutMs ?? SAFETY_MS;

  let safetyTimer = null;
  let busy = false;

  function resolveUnit() {
    return normalizeAdUnit(opts.getAdUnitPath?.());
  }

  function applyUnitConfig() {
    const unit = resolveUnit();
    configureGptRewardedAds(unit ? { adUnitPath: unit } : {});
  }

  function setLoading(active) {
    if (!button) return;
    if (active) {
      button.dataset.adLoading = "1";
      button.textContent = loadingLabel;
    } else {
      delete button.dataset.adLoading;
      button.textContent = actionLabel;
    }
    opts.onLoadingChange?.(active);
  }

  function clearSafety() {
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
  }

  function armSafety() {
    clearSafety();
    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      if (busy) return;
      if (button?.dataset.adLoading !== "1") return;
      setLoading(false);
      void showSiteAlert(
        "광고를 불러오지 못했습니다.\n광고 차단 확장을 끄거나 페이지를 새로고침한 뒤 다시 시도해 주세요.",
        "광고 로드 실패",
      );
    }, safetyMs);
  }

  async function runReward() {
    busy = true;
    try {
      await opts.onReward();
    } finally {
      busy = false;
    }
  }

  applyUnitConfig();
  if (prefetch) {
    void initGptRewardedAds({
      adUnitPath: resolveUnit() || undefined,
      onRewardGranted: () => {
        clearSafety();
        setLoading(false);
        void runReward();
      },
      onAdFlowIdle: () => {
        clearSafety();
        if (!busy) setLoading(false);
      },
    }).catch(() => {});
  } else {
    initGptRewardedAds({
      onRewardGranted: () => {
        clearSafety();
        setLoading(false);
        void runReward();
      },
      onAdFlowIdle: () => {
        clearSafety();
        if (!busy) setLoading(false);
      },
    }).catch(() => {});
  }

  button?.addEventListener("click", () => {
    if (opts.canRun && !opts.canRun()) return;
    if (button.dataset.adLoading === "1" || busy) return;

    if (shouldSkipRewardedAd()) {
      void runReward();
      return;
    }

    applyUnitConfig();
    setLoading(true);
    armSafety();

    void initGptRewardedAds({
      adUnitPath: resolveUnit() || undefined,
      onRewardGranted: () => {
        clearSafety();
        setLoading(false);
        void runReward();
      },
      onAdFlowIdle: () => {
        clearSafety();
        if (!busy) setLoading(false);
      },
    })
      .then(() => requestRewardedAd())
      .catch(() => {
        clearSafety();
        setLoading(false);
      });
  });

  return {
    refreshAdUnit: applyUnitConfig,
    setActionLabel(label) {
      if (!button || button.dataset.adLoading === "1") return;
      button.textContent = label;
    },
  };
}

export {
  configureGptRewardedAds,
  initGptRewardedAds,
  requestRewardedAd,
} from "./gpt-engine.js";
