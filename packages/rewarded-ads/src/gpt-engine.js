/**
 * Google Ad Manager — Rewarded Ads for Web (GPT)
 *
 * 다른 툴/페이지에서 재사용:
 *
 *   <!-- <head> 에 GPT 라이브러리 선로드 (선택, 없으면 모듈이 자동 주입) -->
 *   <script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>
 *
 *   import { initGptRewardedAds, requestRewardedAd } from "../common/gpt-rewarded-ads.js";
 *
 *   await initGptRewardedAds({
 *     onRewardGranted: () => { void runYourAiJob(); },
 *   });
 *
 *   analyzeBtn.addEventListener("click", () => { void requestRewardedAd(); });
 */

import { showSiteAlert, showSiteDialog } from "./site-modal.js";

const GPT_SCRIPT_SRC =
  "https://securepubads.g.doubleclick.net/tag/js/gpt.js";

/**
 * 웹 보상형 GPT 공식 데모 유닛 (로컬·개발 테스트 권장)
 * 실전 전환: configureGptRewardedAds({ adUnitPath: "/23358308038/rewarded_ai_tools" })
 */
const DEFAULT_REWARDED_AD_UNIT = "/22639388115/rewarded_web_example";
/** 모바일 SDK용 테스트 유닛 — 웹 GPT에서는 fill 안 될 수 있음 */
// const MOBILE_SDK_TEST_UNIT = "/21775744923/example/rewarded";
/** @type {string} 실전: Ad Manager 보상형 슬롯 */
// const PRODUCTION_REWARDED_AD_UNIT = "/23358308038/rewarded_ai_tools";

/** @type {string} */
let adUnitPath = DEFAULT_REWARDED_AD_UNIT;

/** @type {import("googletag").Slot | null} */
let rewardedSlot = null;

/** @type {import("googletag").RewardedSlotReadyEvent | null} */
let pendingReadyEvent = null;

/** @type {((evt?: unknown) => void) | null} */
let onRewardGranted = null;

/** @type {(() => void) | null} */
let onAdFlowIdle = null;

let rewardGrantedForRequest = false;

/** @type {Promise<void> | null} */
let initPromise = null;

/** @type {Promise<void> | null} */
let gptScriptPromise = null;

/** GPT 스크립트 영구 로드 실패(차단 등) */
let gptScriptUnavailable = false;

let pubadsListenersAttached = false;
let servicesEnabled = false;
let slotSetupGeneration = 0;

/** 현재 슬롯에 display() 호출 완료 여부 (GPT: 슬롯당 1회 display 후 ready 대기) */
let slotDisplayed = false;

/** 분석하기 클릭 후 ready 이벤트 대기 중 */
let userAwaitingShow = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let displayFailureTimer = null;

let requestSeq = 0;
/** @type {number} */
let activeRequestSeq = 0;
let activeRequestAborted = false;

const REWARDED_LOAD_TIMEOUT_MS = 12_000;
const GPT_API_WAIT_MS = 15_000;
const GPT_CMD_TIMEOUT_MS = 3_000;

function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

function isGptApiReady() {
  const g = window.googletag;
  return !!(
    g &&
    typeof g.defineOutOfPageSlot === "function" &&
    typeof g.pubads === "function" &&
    g.enums?.OutOfPageFormat?.REWARDED != null
  );
}

async function waitForGptApi(timeoutMs = GPT_API_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isGptApiReady()) {
      return /** @type {typeof window.googletag} */ (window.googletag);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("GPT api not ready");
}

/**
 * @param {(googletag: typeof window.googletag) => T} run
 * @param {string} [label]
 * @returns {Promise<T>}
 */
function runGptCmd(run, label = "GPT") {
  return withTimeout(
    ensureGptScript().then(() => {
      const googletag = window.googletag;
      return new Promise((resolve, reject) => {
        googletag.cmd.push(() => {
          try {
            resolve(run(googletag));
          } catch (err) {
            reject(err);
          }
        });
      });
    }),
    GPT_CMD_TIMEOUT_MS,
    `${label} cmd timeout`,
  );
}

/**
 * @typedef {"blocked" | "no-fill" | "timeout" | "slot-missing" | "unsupported"} RewardedFailureKind
 */

/** @type {Record<RewardedFailureKind, { title: string, message: string, offerReload?: boolean }>} */
const FAILURE_COPY = {
  blocked: {
    title: "광고가 차단되었습니다",
    message:
      "광고가 차단되었습니다.\n광고 차단 확장 프로그램을 해제한 뒤 페이지를 새로고침해 주세요.",
    offerReload: true,
  },
  "slot-missing": {
    title: "광고가 차단되었습니다",
    message:
      "광고가 차단되었습니다.\n광고 차단 확장 프로그램을 해제한 뒤 페이지를 새로고침해 주세요.",
    offerReload: true,
  },
  unsupported: {
    title: "보상형 광고 미지원",
    message:
      "이 브라우저·화면 크기에서는 보상형 광고를 표시할 수 없습니다.\n모바일 뷰 또는 다른 브라우저에서 시도해 주세요.",
    offerReload: true,
  },
  "no-fill": {
    title: "안내",
    message: "현재 준비된 광고가 없습니다.\n잠시 후 다시 시도해 주세요.",
  },
  timeout: {
    title: "안내",
    message: "광고 로드 시간이 초과되었습니다.\n잠시 후 다시 시도해 주세요.",
  },
};

function debugLog(...args) {
  try {
    if (
      typeof window !== "undefined" &&
      (window.__ITZ_GPT_REWARDED_DEBUG ||
        new URLSearchParams(window.location.search).has("gpt_debug"))
    ) {
      console.log("[gpt-rewarded]", ...args);
    }
  } catch {
    /* ignore */
  }
}

function clearDisplayFailureTimer() {
  if (displayFailureTimer) {
    clearTimeout(displayFailureTimer);
    displayFailureTimer = null;
  }
}

/** @returns {number} */
function startRewardedRequest() {
  activeRequestSeq = ++requestSeq;
  activeRequestAborted = false;
  rewardGrantedForRequest = false;
  clearDisplayFailureTimer();
  return activeRequestSeq;
}

/** @param {number} seq */
function isActiveRewardedRequest(seq) {
  return seq === activeRequestSeq && !activeRequestAborted;
}

function shouldIgnoreRewardedEvent() {
  return activeRequestAborted;
}

function resetReadyState() {
  pendingReadyEvent = null;
  userAwaitingShow = false;
  slotDisplayed = false;
}

function notifyAdFlowIdle() {
  try {
    onAdFlowIdle?.();
  } catch (err) {
    console.error("[gpt-rewarded] onAdFlowIdle failed", err);
  }
}

function abortActiveRewardedRequest() {
  activeRequestAborted = true;
  userAwaitingShow = false;
  clearDisplayFailureTimer();
  pendingReadyEvent = null;

  const googletag = ensureGoogletag();
  googletag.cmd.push(() => {
    if (rewardedSlot) {
      googletag.destroySlots([rewardedSlot]);
      rewardedSlot = null;
    }
    slotDisplayed = false;
    void setupRewardedSlot().then((ok) => {
      if (ok) void prefetchRewardedAd();
    });
  });
  notifyAdFlowIdle();
}

/** @param {number} seq */
function scheduleDisplayFailureCheck(seq) {
  clearDisplayFailureTimer();
  displayFailureTimer = setTimeout(() => {
    displayFailureTimer = null;
    if (!isActiveRewardedRequest(seq)) return;
    debugLog("load timeout");
    abortActiveRewardedRequest();
    void showRewardedFailureAlert("timeout");
  }, REWARDED_LOAD_TIMEOUT_MS);
}

/**
 * @param {RewardedFailureKind} kind
 * @returns {Promise<void>}
 */
async function showRewardedFailureAlert(kind) {
  const copy = FAILURE_COPY[kind];
  if (!copy) return;

  if (copy.offerReload) {
    const act = await showSiteDialog({
      title: copy.title,
      message: copy.message,
      dialogKind: "gpt-rewarded-block",
      buttons: [
        { label: "새로고침", primary: true, act: "reload" },
        { label: "닫기", act: "close" },
      ],
    });
    if (act === "reload") location.reload();
    notifyAdFlowIdle();
    return;
  }

  await showSiteAlert(copy.message, copy.title);
  notifyAdFlowIdle();
}

/**
 * @param {import("googletag").RewardedSlotReadyEvent} evt
 * @returns {boolean}
 */
function tryShowPendingRewardedAd(evt) {
  if (shouldIgnoreRewardedEvent()) return false;
  if (!userAwaitingShow) return false;
  if (evt.slot !== rewardedSlot) return false;

  userAwaitingShow = false;
  clearDisplayFailureTimer();

  const shown = evt.makeRewardedVisible();
  debugLog("makeRewardedVisible", shown);
  if (!shown) {
    abortActiveRewardedRequest();
    void showRewardedFailureAlert("no-fill");
    return false;
  }
  return true;
}

/**
 * @param {{ adUnitPath?: string }} [cfg]
 */
export function configureGptRewardedAds(cfg = {}) {
  const path = cfg.adUnitPath?.trim();
  if (path && path !== adUnitPath) {
    adUnitPath = path;
    initPromise = null;
    pendingReadyEvent = null;
    slotDisplayed = false;
  } else if (path) {
    adUnitPath = path;
  }
}

function ensureGoogletag() {
  window.googletag = window.googletag || { cmd: /** @type {Array<() => void>} */ ([]) };
  return window.googletag;
}

function ensureGptScriptTag() {
  let tag = document.querySelector(`script[src="${GPT_SCRIPT_SRC}"]`);
  if (tag) return tag;
  tag = document.createElement("script");
  tag.async = true;
  tag.src = GPT_SCRIPT_SRC;
  tag.crossOrigin = "anonymous";
  (document.head || document.documentElement).appendChild(tag);
  return tag;
}

/**
 * @returns {Promise<void>}
 */
function ensureGptScript() {
  if (gptScriptUnavailable) {
    return Promise.reject(new Error("GPT script unavailable"));
  }
  if (gptScriptPromise) return gptScriptPromise;

  gptScriptPromise = (async () => {
    const tag = ensureGptScriptTag();
    if (!isGptApiReady()) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("GPT script load timeout"));
        }, GPT_API_WAIT_MS);

        const poll = setInterval(() => {
          if (isGptApiReady()) {
            cleanup();
            tag.setAttribute("data-gpt-loaded", "1");
            resolve();
          }
        }, 50);

        const onLoad = () => {
          if (isGptApiReady()) {
            cleanup();
            tag.setAttribute("data-gpt-loaded", "1");
            resolve();
          }
        };
        const onError = () => {
          cleanup();
          reject(new Error("GPT script load failed"));
        };

        function cleanup() {
          clearTimeout(timer);
          clearInterval(poll);
          tag.removeEventListener("load", onLoad);
          tag.removeEventListener("error", onError);
        }

        tag.addEventListener("load", onLoad);
        tag.addEventListener("error", onError);
      });
    } else {
      tag.setAttribute("data-gpt-loaded", "1");
    }
    await waitForGptApi();
  })().catch((err) => {
    gptScriptPromise = null;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("load failed")) {
      gptScriptUnavailable = true;
    }
    throw err;
  });

  return gptScriptPromise;
}

function attachPubadsListeners(googletag) {
  if (pubadsListenersAttached) return;
  pubadsListenersAttached = true;

  googletag.pubads().addEventListener("rewardedSlotReady", (evt) => {
    if (shouldIgnoreRewardedEvent()) return;
    if (evt.slot !== rewardedSlot) return;

    debugLog("rewardedSlotReady");
    pendingReadyEvent = evt;
    tryShowPendingRewardedAd(evt);
  });

  googletag.pubads().addEventListener("rewardedSlotGranted", (evt) => {
    if (shouldIgnoreRewardedEvent()) return;
    clearDisplayFailureTimer();
    userAwaitingShow = false;
    pendingReadyEvent = null;
    rewardGrantedForRequest = true;
    console.log(
      "[gpt-rewarded] 구글 보상 확인 완료! AI 연산 및 다운로드를 시작합니다.",
    );
    try {
      onRewardGranted?.(evt);
    } catch (err) {
      console.error("[gpt-rewarded] onRewardGranted handler failed", err);
    }
  });

  googletag.pubads().addEventListener("rewardedSlotClosed", () => {
    if (shouldIgnoreRewardedEvent()) return;
    clearDisplayFailureTimer();
    userAwaitingShow = false;
    pendingReadyEvent = null;
    slotDisplayed = false;
    const granted = rewardGrantedForRequest;
    rewardGrantedForRequest = false;

    if (rewardedSlot) {
      googletag.destroySlots([rewardedSlot]);
      rewardedSlot = null;
    }
    void setupRewardedSlot().then((ok) => {
      if (ok) void prefetchRewardedAd();
    });
    if (!granted) notifyAdFlowIdle();
  });
}

/**
 * @returns {Promise<boolean>}
 */
function setupRewardedSlot() {
  const generation = ++slotSetupGeneration;
  return runGptCmd((googletag) => {
    if (generation !== slotSetupGeneration) {
      return !!rewardedSlot;
    }

    if (rewardedSlot) {
      googletag.destroySlots([rewardedSlot]);
      rewardedSlot = null;
    }

    resetReadyState();

    rewardedSlot = googletag.defineOutOfPageSlot(
      adUnitPath,
      googletag.enums.OutOfPageFormat.REWARDED,
    );

    if (rewardedSlot) {
      rewardedSlot.addService(googletag.pubads());
      attachPubadsListeners(googletag);
      debugLog("slot defined", adUnitPath);
    } else {
      debugLog("defineOutOfPageSlot returned null (unsupported environment)");
    }

    if (!servicesEnabled) {
      googletag.enableServices();
      servicesEnabled = true;
    }

    return !!rewardedSlot;
  }, "setupRewardedSlot");
}

/**
 * Google 권장: 슬롯 정의 후 display()로 프리로드 → ready 시 makeRewardedVisible()
 * @returns {Promise<void>}
 */
function prefetchRewardedAd() {
  return runGptCmd((googletag) => {
    if (!rewardedSlot || slotDisplayed) {
      return;
    }
    debugLog("prefetch display");
    googletag.display(rewardedSlot);
    slotDisplayed = true;
  }, "prefetchRewardedAd");
}

/**
 * GPT 보상형 광고 초기화 (페이지당 1회)
 *
 * @param {{ onRewardGranted?: (evt?: unknown) => void, adUnitPath?: string }} [opts]
 * @returns {Promise<void>}
 */
export async function initGptRewardedAds(opts = {}) {
  if (opts.adUnitPath?.trim()) adUnitPath = opts.adUnitPath.trim();
  if (typeof opts.onRewardGranted === "function") {
    onRewardGranted = opts.onRewardGranted;
  }
  if (typeof opts.onAdFlowIdle === "function") {
    onAdFlowIdle = opts.onAdFlowIdle;
  }

  if (gptScriptUnavailable) {
    throw new Error("GPT script unavailable");
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    await ensureGptScript();
    const ok = await setupRewardedSlot();
    if (!ok) {
      throw new Error("Rewarded slot unsupported");
    }
    await prefetchRewardedAd();
  })().catch((err) => {
    initPromise = null;
    console.warn("[gpt-rewarded] 초기화 실패", err);
    throw err;
  });

  return initPromise;
}

/** @returns {boolean} */
export function isRewardedSlotReady() {
  return !!pendingReadyEvent;
}

/**
 * @returns {Promise<void>}
 */
export async function requestRewardedAd() {
  if (!onRewardGranted) {
    console.warn("[gpt-rewarded] onRewardGranted 미설정 — initGptRewardedAds()를 먼저 호출하세요.");
    return;
  }

  if (gptScriptUnavailable) {
    await showRewardedFailureAlert("blocked");
    return;
  }

  try {
    await initGptRewardedAds();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unsupported")) {
      await showRewardedFailureAlert("unsupported");
    } else if (msg.includes("not ready") || msg.includes("load failed") || msg.includes("unavailable")) {
      await showRewardedFailureAlert("blocked");
    } else {
      await showRewardedFailureAlert("timeout");
    }
    return;
  }

  if (!rewardedSlot) {
    await showRewardedFailureAlert("unsupported");
    return;
  }

  const requestId = startRewardedRequest();
  userAwaitingShow = true;
  scheduleDisplayFailureCheck(requestId);

  if (pendingReadyEvent && pendingReadyEvent.slot === rewardedSlot) {
    debugLog("ready event already pending — show immediately");
    if (tryShowPendingRewardedAd(pendingReadyEvent)) return;
  }

  const googletag = ensureGoogletag();
  void runGptCmd(() => {
    if (!isActiveRewardedRequest(requestId)) return;

    if (!rewardedSlot) {
      abortActiveRewardedRequest();
      void showRewardedFailureAlert("unsupported");
      return;
    }

    if (!slotDisplayed) {
      debugLog("display on click");
      googletag.display(rewardedSlot);
      slotDisplayed = true;
    }
  }, "displayRewardedAd").catch((err) => {
    debugLog("display failed", err);
    if (isActiveRewardedRequest(requestId)) {
      abortActiveRewardedRequest();
      void showRewardedFailureAlert("timeout");
    }
  });
}

if (typeof window !== "undefined") {
  window.ItMatZipGptRewarded = {
    configure: configureGptRewardedAds,
    init: initGptRewardedAds,
    request: requestRewardedAd,
    isReady: isRewardedSlotReady,
  };
}
