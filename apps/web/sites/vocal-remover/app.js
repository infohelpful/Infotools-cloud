import toolConfig from "./tool.config.json";
import {
  fetchPublicConfig,
  uploadFile,
  submitJob,
  pollJobUntilDone,
  resolveApiBase,
  resolveRewardedAdUnit,
  injectAdSense,
} from "@infotools/web-sdk";
import { bindRewardedAction } from "@infotools/rewarded-ads";
import { createVocalDualPlayer } from "./dual-player.js";

const ANALYZE_LABEL = "무료 분석하기 ( 30초 광고 시청 )";

const SERVICE_ID = toolConfig.serviceId;
const dualPlayer = createVocalDualPlayer();

const fileInput = document.getElementById("file-input");
const audioPathInput = document.getElementById("audio-path");
const btnPickFile = document.getElementById("btn-pick-file");
const btnAnalyze = document.getElementById("btn-analyze");
const formatSelect = document.getElementById("format");
const btnDlZip = document.getElementById("btn-dl-zip");
const aiBanner = document.getElementById("ai-banner");
const dropOverlay = document.getElementById("drop-overlay");
const separationLoading = document.getElementById("separation-loading");
const separationLoadingStep = document.getElementById("separation-loading-step");
const separationLoadingBar = document.getElementById("separation-loading-bar");
const separationLoadingPercent = document.getElementById("separation-loading-percent");
const separationLoadingMessage = document.getElementById("separation-loading-message");
const separationLoadingTrack = document.getElementById("separation-loading-track");
const dualWaveformSection = document.getElementById("dual-waveform-section");

let selectedFile = null;
let latestPendingFile = null;
let apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";
let publicConfig = null;
let mrDownloadUrl = "";
let vocalDownloadUrl = "";
let downloadExt = "wav";
let dragDepth = 0;
let conversionHistory = [];
try {
  conversionHistory = JSON.parse(localStorage.getItem("vocal_remover_history") || "[]");
} catch (e) {
  conversionHistory = [];
}

// 3시간 지난 만료된 이력 자동 필터링 및 로컬스토리지 청소
function cleanExpiredHistory() {
  const expiryLimit = 3 * 60 * 60 * 1000; // 3시간 (ms)
  const now = Date.now();
  let updated = false;

  conversionHistory = conversionHistory.filter((item) => {
    const createdTime = item.createdAt || Number(item.id);
    if (!createdTime || isNaN(createdTime)) return true;

    const isExpired = now - createdTime > expiryLimit;
    if (isExpired) {
      updated = true;
      return false;
    }
    return true;
  });

  if (updated) {
    try {
      localStorage.setItem("vocal_remover_history", JSON.stringify(conversionHistory));
    } catch (err) {
      console.warn("Failed to sync expired history to localStorage:", err);
    }
  }
}

cleanExpiredHistory();

let currentFileHash = "";
let lastAnalyzedFileHash = "";
let lastAnalyzedFormat = "";

let progressTrickleInterval = null;
let currentUiProgress = 0;

function setSeparationLoading(active, { step, message, progress } = {}) {
  if (!separationLoading) return;

  if (active) {
    separationLoading.hidden = false;
    separationLoading.classList.add("is-active");
    dualWaveformSection?.classList.add("is-separating");
    if (step && separationLoadingStep) separationLoadingStep.textContent = step;
    if (message && separationLoadingMessage) separationLoadingMessage.textContent = message;
    if (separationLoadingBar && separationLoadingTrack) {
      if (typeof progress === "number") {
        const updateUI = (pct) => {
          const clamped = Math.max(0, Math.min(100, pct));
          separationLoadingBar.style.width = `${clamped}%`;
          separationLoadingBar.classList.add("is-determinate");
          separationLoadingTrack.setAttribute("aria-valuenow", String(Math.round(clamped)));
          if (separationLoadingPercent) separationLoadingPercent.textContent = `${Math.round(clamped)}%`;
        };

        if (progress === 55) {
          // AI 분리 연산(55%) 중일 때 이미 애니메이션이 돌고 있다면 리셋 방지 및 무시
          if (!progressTrickleInterval) {
            currentUiProgress = 55;
            updateUI(currentUiProgress);
            progressTrickleInterval = setInterval(() => {
              if (currentUiProgress < 75) {
                currentUiProgress += 1.2 + Math.random() * 1.5;
              } else if (currentUiProgress < 88) {
                currentUiProgress += 0.6 + Math.random() * 1.0;
              } else if (currentUiProgress < 96) {
                currentUiProgress += 0.15 + Math.random() * 0.35;
              } else {
                return;
              }
              updateUI(currentUiProgress);
            }, 350);
          }
        } else {
          // 55%가 아닌 다른 진행도가 들어왔을 때는 기존 타이머를 무조건 해제하고 해당 값 즉시 매핑
          if (progressTrickleInterval) {
            clearInterval(progressTrickleInterval);
            progressTrickleInterval = null;
          }
          currentUiProgress = progress;
          updateUI(currentUiProgress);
        }
      } else {
        if (progressTrickleInterval) {
          clearInterval(progressTrickleInterval);
          progressTrickleInterval = null;
        }
        separationLoadingBar.style.width = "";
        separationLoadingBar.classList.remove("is-determinate");
        separationLoadingTrack.setAttribute("aria-valuenow", "0");
        if (separationLoadingPercent) separationLoadingPercent.textContent = "…";
      }
    }
    return;
  }
  
  if (progressTrickleInterval) {
    clearInterval(progressTrickleInterval);
    progressTrickleInterval = null;
  }
  separationLoading.hidden = true;
  separationLoading.classList.remove("is-active");
  dualWaveformSection?.classList.remove("is-separating");
}

function setDownloadReady(ready) {
  if (btnDlZip) {
    if (ready) {
      btnDlZip.classList.remove("disabled");
      btnDlZip.removeAttribute("aria-disabled");
    } else {
      btnDlZip.classList.add("disabled");
      btnDlZip.setAttribute("aria-disabled", "true");
    }
  }
}

function updateAnalyzeButton() {
  if (!btnAnalyze) return;

  const isBusy = btnAnalyze.dataset.busy === "1";
  const isAdLoading = btnAnalyze.dataset.adLoading === "1";
  const hasFile = !!selectedFile;

  const isAlreadyAnalyzed =
    hasFile &&
    currentFileHash &&
    currentFileHash === lastAnalyzedFileHash &&
    (formatSelect?.value || "wav") === lastAnalyzedFormat;

  if (isBusy || isAdLoading || !hasFile || isAlreadyAnalyzed) {
    btnAnalyze.disabled = true;
    if (isAlreadyAnalyzed) {
      btnAnalyze.textContent = "분석 완료 (재생/다운로드 가능)";
    }
  } else {
    btnAnalyze.disabled = false;
    btnAnalyze.textContent = "무료 분석하기 ( 30초 광고 시청 )";
  }
}

function applySelectedFile(file) {
  if (!file) return;

  // 1. 파일 포맷 체크
  if (!file.type.startsWith("audio/") && !/\.(wav|mp3|flac|m4a|ogg|aac)$/i.test(file.name)) {
    alert("오디오 파일만 선택할 수 있습니다.");
    return;
  }

  // 2. 파일 크기 체크 (최대 30MB)
  const MAX_SIZE_MB = 30;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    alert(`최대 ${MAX_SIZE_MB}MB 이하의 오디오 파일만 업로드할 수 있습니다.`);
    return;
  }

  // 3. 파일 재생 시간 체크 (최대 5분 / 300초)
  latestPendingFile = file;
  const objectUrl = URL.createObjectURL(file);
  const audio = new Audio();
  audio.src = objectUrl;

  audio.addEventListener("loadedmetadata", () => {
    URL.revokeObjectURL(objectUrl);
    if (file !== latestPendingFile) return;

    const duration = audio.duration;
    if (duration > 360) {
      alert("최대 6분(360초) 이하의 오디오 파일만 업로드할 수 있습니다.");
      return;
    }

    // 모든 조건 검증 완료 시에만 데이터 바인딩 및 UI 업데이트
    selectedFile = file;
    if (audioPathInput) audioPathInput.value = file.name;
    dualPlayer.prepareForFilePick(file.name);
    setDownloadReady(false);
    mrDownloadUrl = "";
    vocalDownloadUrl = "";
    
    currentFileHash = "";
    updateAnalyzeButton();
    calculateFileHash(file).then((hash) => {
      if (selectedFile === file) {
        currentFileHash = hash;
        updateAnalyzeButton();
      }
    });
  });

  audio.addEventListener("error", () => {
    URL.revokeObjectURL(objectUrl);
    if (file !== latestPendingFile) return;
    alert("오디오 파일 메타데이터를 분석할 수 없습니다. 손상된 파일이거나 지원하지 않는 코덱일 수 있습니다.");
  });
}

function showAiBanner(devAi) {
  if (!aiBanner || !devAi) return;
  
  // 운영 환경일 때는 AI 상태 배너를 노출하지 않음
  if (publicConfig && publicConfig.activeEnvironment === "production") {
    aiBanner.hidden = true;
    return;
  }

  if (devAi.mockSeparation) {
    aiBanner.hidden = false;
    aiBanner.className = "ai-banner warn";
    aiBanner.textContent =
      devAi.message ||
      "⚠ 가짜 분리 모드 — 결과가 원본과 같습니다. npm run dev 로 Demucs AI 서버를 사용하세요.";
    return;
  }
  aiBanner.hidden = false;
  aiBanner.className = "ai-banner ok";
  aiBanner.textContent = devAi.message || "Demucs 실제 분리 모드";
}

async function ensureApiBase() {
  const origin = apiBaseUrl || window.location.origin;
  publicConfig = await fetchPublicConfig(origin);
  apiBaseUrl = resolveApiBase(publicConfig, origin);
  showAiBanner(publicConfig.devAi);
  rewardedAds?.refreshAdUnit();
  injectAdSense(publicConfig, SERVICE_ID);
  return apiBaseUrl;
}

function absoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${apiBaseUrl.replace(/\/$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

async function triggerDownload(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

btnPickFile?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) applySelectedFile(file);
  if (fileInput) fileInput.value = "";
});

async function calculateFileHash(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function runAnalysis() {
  if (!selectedFile) return;
  if (publicConfig?.devAi?.mockSeparation) {
    const ok = confirm(
      "현재 가짜 분리 모드입니다 — MR·보컬이 원본과 동일하게 나옵니다.\n그래도 계속할까요?",
    );
    if (!ok) return;
  }

  btnAnalyze.dataset.busy = "1";
  updateAnalyzeButton();
  setDownloadReady(false);
  dualPlayer.prepareForSeparation(selectedFile.name);
  setSeparationLoading(true, {
    step: "업로드 중…",
    message: "클라우드 스토리지에 오디오를 전송합니다.",
    progress: 5,
  });

  try {
    const base = await ensureApiBase();
    const fileHash = await calculateFileHash(selectedFile);
    const uploaded = await uploadFile(base, selectedFile, toolConfig.uploadPrefix, publicConfig);

    setSeparationLoading(true, {
      step: "AI 분리 요청…",
      message: "AI 음악 / 보컬 분리 작업을 시작합니다.",
      progress: 18,
    });

    const job = await submitJob(
      base,
      SERVICE_ID,
      {
        audioKey: uploaded.key,
        format: formatSelect?.value || toolConfig.defaultFormat,
        device: "auto",
        fileHash: fileHash,
      },
      publicConfig,
    );

    if (job && job.status === "COMPLETED") {
      showToast("⚡ 이전 분석 결과를 캐시에서 즉시 불러왔습니다!", "success");
    }

    const done = await pollJobUntilDone({
      apiBase: base,
      serviceId: SERVICE_ID,
      jobId: job.id,
      config: publicConfig,
      onTick: (st) => {
        if (st.status === "IN_QUEUE") {
          setSeparationLoading(true, { step: "대기열…", progress: 28 });
        } else if (st.status === "IN_PROGRESS") {
          setSeparationLoading(true, {
            step: "AI 음악 / 보컬 분리 중…",
            message: "MR·보컬 스템을 생성하고 있습니다.",
            progress: 55,
          });
        }
      },
    });

    const out = done.output || {};
    mrDownloadUrl = absoluteUrl(out.instrumentalUrl);
    vocalDownloadUrl = absoluteUrl(out.vocalsUrl);
    downloadExt = formatSelect?.value || "wav";

    await dualPlayer.onSeparationComplete({
      mrUrl: mrDownloadUrl,
      vocalUrl: vocalDownloadUrl,
      sourceName: selectedFile.name,
      durationSec: typeof out.durationSec === "number" ? out.durationSec : 0,
    });

    setSeparationLoading(true, { step: "완료", progress: 100 });
    setDownloadReady(true);

    // 작업 완료 내역 로컬 스토리지에 추가
    try {
      const historyItem = {
        id: Date.now().toString(),
        fileName: selectedFile.name,
        mrUrl: mrDownloadUrl,
        vocalUrl: vocalDownloadUrl,
        format: downloadExt,
        timestamp: new Date().toLocaleString("ko-KR"),
        createdAt: Date.now(),
      };
      conversionHistory.unshift(historyItem);
      localStorage.setItem("vocal_remover_history", JSON.stringify(conversionHistory));
      renderHistoryList();

      lastAnalyzedFileHash = currentFileHash;
      lastAnalyzedFormat = downloadExt;
      updateAnalyzeButton();
    } catch (e) {
      console.warn("Failed to save to history", e);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dualPlayer.prepareForFilePick(selectedFile?.name || "");
    alert(`분리 실패: ${msg}`);
  } finally {
    setSeparationLoading(false);
    btnAnalyze.dataset.busy = "0";
    updateAnalyzeButton();
  }
}

async function downloadAsZip(mrUrl, vocalUrl, fileName, formatVal) {
  if (!window.JSZip) {
    throw new Error("JSZip 라이브러리가 로드되지 않았습니다.");
  }
  const cleanName = fileName.replace(/\.[^.]+$/, "") || "separated";
  
  const mrRes = await fetch(mrUrl);
  if (!mrRes.ok) throw new Error("MR 오디오 다운로드 실패");
  const mrBlob = await mrRes.blob();
  
  const vocRes = await fetch(vocalUrl);
  if (!vocRes.ok) throw new Error("보컬 오디오 다운로드 실패");
  const vocBlob = await vocRes.blob();
  
  const zip = new window.JSZip();
  zip.file(`${cleanName}-mr.${formatVal}`, mrBlob);
  zip.file(`${cleanName}-vocals.wav`, vocBlob);
  
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const blobUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = `${cleanName}-separated.zip`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

btnDlZip?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (btnDlZip.classList.contains("disabled")) return;
  if (!mrDownloadUrl || !vocalDownloadUrl) return;
  const originalText = btnDlZip.textContent;
  try {
    btnDlZip.classList.add("disabled");
    btnDlZip.textContent = "⏳ ZIP 파일 압축 및 다운로드 중...";
    await downloadAsZip(mrDownloadUrl, vocalDownloadUrl, selectedFile.name, downloadExt);
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  } finally {
    btnDlZip.classList.remove("disabled");
    btnDlZip.textContent = originalText;
  }
});

function isAudioDrag(dt) {
  if (!dt) return false;
  if (dt.types?.includes("Files")) return true;
  return Array.from(dt.items || []).some((item) => item.kind === "file");
}

document.addEventListener("dragenter", (e) => {
  if (!isAudioDrag(e.dataTransfer)) return;
  e.preventDefault();
  dragDepth += 1;
  document.body.classList.add("is-drag-over");
  if (dropOverlay) dropOverlay.setAttribute("aria-hidden", "false");
});

document.addEventListener("dragover", (e) => {
  if (!isAudioDrag(e.dataTransfer)) return;
  e.preventDefault();
});

document.addEventListener("dragleave", (e) => {
  if (!isAudioDrag(e.dataTransfer)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    document.body.classList.remove("is-drag-over");
    if (dropOverlay) dropOverlay.setAttribute("aria-hidden", "true");
  }
});

document.addEventListener("drop", (e) => {
  if (!isAudioDrag(e.dataTransfer)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("is-drag-over");
  if (dropOverlay) dropOverlay.setAttribute("aria-hidden", "true");
  const file = e.dataTransfer?.files?.[0];
  if (file) applySelectedFile(file);
});

const rewardedAds = bindRewardedAction({
  serviceId: SERVICE_ID,
  button: btnAnalyze,
  actionLabel: ANALYZE_LABEL,
  canRun: () =>
    !!selectedFile &&
    btnAnalyze?.dataset.busy !== "1" &&
    btnAnalyze?.dataset.adLoading !== "1",
  getAdUnitPath: () => resolveRewardedAdUnit(publicConfig, SERVICE_ID),
  onReward: () => runAnalysis(),
  onLoadingChange: () => updateAnalyzeButton(),
});

void ensureApiBase().catch(() => {
  if (aiBanner) {
    aiBanner.hidden = false;
    aiBanner.className = "ai-banner warn";
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isLocal) {
      aiBanner.textContent = "API에 연결할 수 없습니다. npm run dev 로 mock-infra를 실행하세요.";
    } else {
      aiBanner.textContent = "서버와의 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";
    }
  }
});

updateAnalyzeButton();

function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast-item toast-${type}`;

  const textNode = document.createElement("div");
  textNode.className = "toast-text";
  textNode.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px) scale(0.95)";
    setTimeout(() => {
      toast.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 300);
  });

  toast.appendChild(textNode);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(20px) scale(0.95)";
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
          if (container.children.length === 0) {
            container.remove();
          }
        }
      }, 300);
    }
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderHistoryList() {
  cleanExpiredHistory();
  const container = document.getElementById("history-items-container");
  if (!container) return;
  if (conversionHistory.length === 0) {
    container.innerHTML = `
      <div class="history-empty">
        <span style="font-size: 28px;">📁</span>
        최근 분리한 내역이 없습니다.
      </div>
    `;
    return;
  }
  container.innerHTML = conversionHistory.map(item => `
    <div class="history-item">
      <div class="history-item-info">
        <div class="history-item-title">${escapeHtml(item.fileName)}</div>
        <div class="history-item-meta">${item.timestamp} · ${item.format.toUpperCase()} 포맷</div>
      </div>
      <div class="history-item-actions">
        <a href="#" class="btn-history-dl btn-history-dl-zip" data-id="${item.id}" role="button">
          📥 보컬 / 음악 다운로드
        </a>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".btn-history-dl-zip").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (btn.classList.contains("disabled")) return;
      const id = btn.getAttribute("data-id");
      const item = conversionHistory.find(h => h.id === id);
      if (item) {
        const originalText = btn.textContent;
        try {
          btn.classList.add("disabled");
          btn.textContent = "⏳ 다운로드 중...";
          await downloadAsZip(item.mrUrl, item.vocalUrl, item.fileName, item.format);
        } catch (err) {
          alert(`다운로드 실패: ${err.message}`);
        } finally {
          btn.classList.remove("disabled");
          btn.textContent = originalText;
        }
      }
    });
  });
}

// 탭 스위칭 로직
const tabButtons = document.querySelectorAll(".tab-btn");
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.getAttribute("data-tab");
    
    tabButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    
    document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));
    document.getElementById(`tab-pane-${tabName}`).classList.add("active");
    
    if (tabName === "history") {
      renderHistoryList();
    }
  });
});

// 히스토리 초기 렌더링 및 클리어 기능 바인딩
const btnClearHistory = document.getElementById("btn-clear-history");
btnClearHistory?.addEventListener("click", () => {
  if (confirm("모든 작업 내역을 삭제하시겠습니까?")) {
    conversionHistory = [];
    localStorage.removeItem("vocal_remover_history");
    renderHistoryList();
    showToast("모든 작업 내역이 삭제되었습니다.", "info");
  }
});

renderHistoryList();
