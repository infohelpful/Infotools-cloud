const API = import.meta.env.VITE_API_BASE_URL || window.location.origin;

const envSelect = document.getElementById("env-select");
const defaultAdUnitInput = document.getElementById("default-ad-unit");
const globalAdsenseClientInput = document.getElementById("global-adsense-client");
const globalAdsenseTopSlotInput = document.getElementById("global-adsense-top-slot");
const globalAdsenseBottomSlotInput = document.getElementById("global-adsense-bottom-slot");

const r2AccountIdInput = document.getElementById("r2-account-id");
const r2S3EndpointInput = document.getElementById("r2-s3-endpoint");
const r2AccessKeyIdInput = document.getElementById("r2-access-key-id");
const r2SecretAccessKeyInput = document.getElementById("r2-secret-access-key");
const runpodApiKeyInput = document.getElementById("runpod-api-key");
const envR2BucketInput = document.getElementById("env-r2-bucket");
const envR2PublicBaseUrlInput = document.getElementById("env-r2-public-base-url");
const envRunpodEndpointInput = document.getElementById("env-runpod-endpoint");
const adminKvHint = document.getElementById("admin-kv-hint");

const loginContainer = document.getElementById("login-container");
const adminContainer = document.getElementById("admin-container");
const btnLogin = document.getElementById("btn-login");
const loginIdInput = document.getElementById("login-id");
const loginPwInput = document.getElementById("login-pw");
const loginError = document.getElementById("login-error");

const globalAdminView = document.getElementById("global-admin-view");
const serviceDetailAdminView = document.getElementById("service-detail-admin-view");
const adminServicesGrid = document.getElementById("admin-services-grid");
const btnSaveGlobal = document.getElementById("btn-save-global");
const saveMsgGlobal = document.getElementById("save-msg-global");
const btnBackToList = document.getElementById("btn-back-to-list");
const btnSaveDetail = document.getElementById("btn-save-detail");
const saveMsgDetail = document.getElementById("save-msg-detail");

const selectedServiceIcon = document.getElementById("selected-service-icon");
const selectedServiceName = document.getElementById("selected-service-name");
const detailSvcEnabled = document.getElementById("detail-svc-enabled");
const detailSvcAdminOnly = document.getElementById("detail-svc-admin-only");
const detailSvcAdUnit = document.getElementById("detail-svc-ad-unit");
const detailSvcAdsenseClient = document.getElementById("detail-svc-adsense-client");
const detailSvcAdsenseTop = document.getElementById("detail-svc-adsense-top");
const detailSvcAdsenseBottom = document.getElementById("detail-svc-adsense-bottom");

/** @type {{ activeEnvironment?: string, defaultRewardedAdUnit?: string, services?: Array<Record<string, unknown>> }} */
let state = {};
let currentServiceIdx = null;

function activeEnvId() {
  return envSelect?.value || state.activeEnvironment || "local-mock";
}

function ensureEnvProfile(envId) {
  if (!state.environments) state.environments = {};
  if (!state.environments[envId]) state.environments[envId] = { storage: {}, inference: { endpoints: {} } };
  const profile = state.environments[envId];
  if (!profile.storage) profile.storage = {};
  if (!profile.inference) profile.inference = {};
  if (!profile.inference.endpoints) profile.inference.endpoints = {};
  return profile;
}

function loadActiveEnvProfileToInputs() {
  const profile = ensureEnvProfile(activeEnvId());
  if (envR2BucketInput) envR2BucketInput.value = profile.storage?.bucket || "";
  if (envR2PublicBaseUrlInput) envR2PublicBaseUrlInput.value = profile.storage?.publicBaseUrl || "";
  if (envRunpodEndpointInput) {
    envRunpodEndpointInput.value = profile.inference?.endpoints?.["vocal-remover"] || "";
  }
}

function syncActiveEnvProfileFromInputs() {
  const profile = ensureEnvProfile(activeEnvId());
  profile.storage.bucket = envR2BucketInput?.value?.trim() || "";
  profile.storage.publicBaseUrl = envR2PublicBaseUrlInput?.value?.trim() || "";
  profile.inference.endpoints["vocal-remover"] = envRunpodEndpointInput?.value?.trim() || "";
}

function updateAdminKvHint(meta) {
  if (!adminKvHint) return;
  if (meta && meta.kvConfigured === false) {
    adminKvHint.style.display = "block";
    adminKvHint.textContent =
      "⚠️ ADMIN_KV가 설정되지 않았습니다. Pages 운영에서는 wrangler.toml에 KV 바인딩 후 재배포해야 설정이 저장됩니다.";
  } else {
    adminKvHint.style.display = "none";
    adminKvHint.textContent = "";
  }
}

function checkAuth() {
  const token = sessionStorage.getItem("info_admin_token");
  if (token) {
    if (loginContainer) loginContainer.style.display = "none";
    if (adminContainer) adminContainer.style.display = "block";
    void load(token).catch((e) => {
      if (saveMsgGlobal) saveMsgGlobal.textContent = e instanceof Error ? e.message : String(e);
    });
  } else {
    if (loginContainer) loginContainer.style.display = "flex";
    if (adminContainer) adminContainer.style.display = "none";
  }
}

function handleAuthError() {
  sessionStorage.removeItem("info_admin_token");
  checkAuth();
}

btnLogin?.addEventListener("click", async () => {
  const username = loginIdInput?.value?.trim();
  const password = loginPwInput?.value?.trim();
  if (loginError) loginError.hidden = true;

  try {
    const res = await fetch(`${API.replace(/\/$/, "")}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      const data = await res.json();
      sessionStorage.setItem("info_admin_token", data.token);
      checkAuth();
    } else {
      if (loginError) {
        loginError.textContent = "아이디 또는 비밀번호가 일치하지 않습니다.";
        loginError.hidden = false;
      }
    }
  } catch (err) {
    if (loginError) {
      loginError.textContent = "서버 연결에 실패했습니다.";
      loginError.hidden = false;
    }
  }
});

loginIdInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnLogin?.click();
});
loginPwInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnLogin?.click();
});

async function load(token) {
  const res = await fetch(`${API.replace(/\/$/, "")}/api/admin/state`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (res.status === 401) {
    handleAuthError();
    return;
  }
  if (!res.ok) throw new Error(`admin load ${res.status}`);
  state = await res.json();
  envSelect.value = state.activeEnvironment || "local-mock";
  if (defaultAdUnitInput) {
    defaultAdUnitInput.value = state.defaultRewardedAdUnit || "";
  }
  if (globalAdsenseClientInput) {
    globalAdsenseClientInput.value = state.adsenseClientId || "";
  }
  if (globalAdsenseTopSlotInput) {
    globalAdsenseTopSlotInput.value = state.adsenseTopSlot || "";
  }
  if (globalAdsenseBottomSlotInput) {
    globalAdsenseBottomSlotInput.value = state.adsenseBottomSlot || "";
  }
  if (r2AccountIdInput) {
    r2AccountIdInput.value = state.r2AccountId || "";
  }
  if (r2S3EndpointInput) {
    r2S3EndpointInput.value = state.r2S3Endpoint || "";
  }
  if (r2AccessKeyIdInput) {
    r2AccessKeyIdInput.value = state.r2AccessKeyId || "";
  }
  if (r2SecretAccessKeyInput) {
    r2SecretAccessKeyInput.value = state.r2SecretAccessKey || "";
  }
  if (runpodApiKeyInput) {
    runpodApiKeyInput.value = state.runpodApiKey || "";
  }
  loadActiveEnvProfileToInputs();
  updateAdminKvHint(state.meta);
  renderServicesList();
}

envSelect?.addEventListener("change", () => {
  loadActiveEnvProfileToInputs();
});

function renderServicesList() {
  if (!adminServicesGrid) return;
  const services = state.services || [];
  adminServicesGrid.innerHTML = services
    .map(
      (s, i) => `
    <div class="admin-service-card" data-idx="${i}">
      <div class="admin-service-card-icon">${s.icon || "🎙️"}</div>
      <div class="admin-service-card-info">
        <strong>${s.nameKo || s.name}</strong>
        <span>${s.id}</span>
      </div>
    </div>`,
    )
    .join("");
}

adminServicesGrid?.addEventListener("click", (ev) => {
  const card = ev.target.closest(".admin-service-card");
  if (!card) return;
  const idx = Number(card.getAttribute("data-idx"));
  showServiceDetail(idx);
});

function showServiceDetail(idx) {
  currentServiceIdx = idx;
  const s = state.services[idx];
  if (!s) return;

  if (selectedServiceIcon) selectedServiceIcon.textContent = s.icon || "🎙️";
  if (selectedServiceName) selectedServiceName.textContent = s.nameKo || s.name;
  if (detailSvcEnabled) detailSvcEnabled.checked = s.enabled !== false;
  if (detailSvcAdminOnly) detailSvcAdminOnly.checked = s.adminOnly === true;
  if (detailSvcAdUnit) detailSvcAdUnit.value = s.rewardedAdUnit || "";
  if (detailSvcAdsenseClient) detailSvcAdsenseClient.value = s.adsenseClientId || "";
  if (detailSvcAdsenseTop) detailSvcAdsenseTop.value = s.adsenseTopSlot || "";
  if (detailSvcAdsenseBottom) detailSvcAdsenseBottom.value = s.adsenseBottomSlot || "";

  if (saveMsgDetail) saveMsgDetail.textContent = "";

  const cleanupPanel = document.getElementById("cleanup-panel");
  const cleanupStatusMsg = document.getElementById("cleanup-status-msg");
  if (cleanupPanel) {
    if (s.id === "vocal-remover") {
      cleanupPanel.style.display = "block";
    } else {
      cleanupPanel.style.display = "none";
    }
  }
  if (cleanupStatusMsg) cleanupStatusMsg.textContent = "";

  if (globalAdminView) globalAdminView.style.display = "none";
  if (serviceDetailAdminView) serviceDetailAdminView.style.display = "flex";
}

btnBackToList?.addEventListener("click", () => {
  if (globalAdminView) globalAdminView.style.display = "flex";
  if (serviceDetailAdminView) serviceDetailAdminView.style.display = "none";
  currentServiceIdx = null;
});

async function saveAllState(saveMsgElement) {
  const token = sessionStorage.getItem("info_admin_token");
  if (!token) {
    handleAuthError();
    return;
  }
  
  if (saveMsgElement) saveMsgElement.textContent = "저장 중...";
  
  try {
    const res = await fetch(`${API.replace(/\/$/, "")}/api/admin/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        activeEnvironment: state.activeEnvironment,
        defaultRewardedAdUnit: state.defaultRewardedAdUnit,
        adsenseClientId: state.adsenseClientId,
        adsenseTopSlot: state.adsenseTopSlot,
        adsenseBottomSlot: state.adsenseBottomSlot,
        r2AccountId: state.r2AccountId,
        r2S3Endpoint: state.r2S3Endpoint,
        r2AccessKeyId: state.r2AccessKeyId,
        r2SecretAccessKey: state.r2SecretAccessKey,
        runpodApiKey: state.runpodApiKey,
        environments: state.environments,
        services: state.services,
      }),
    });
    
    if (res.status === 401) {
      handleAuthError();
      return;
    }
    
    if (!res.ok) {
      let errText = `저장 실패: ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error) errText = errBody.error;
      } catch {
        /* ignore */
      }
      if (saveMsgElement) saveMsgElement.textContent = errText;
      return;
    }

    state = await res.json();
    updateAdminKvHint(state.meta);
    if (saveMsgElement) saveMsgElement.textContent = "저장되었습니다.";
    renderServicesList();
  } catch (err) {
    if (saveMsgElement) saveMsgElement.textContent = "저장 중 오류가 발생했습니다.";
  }
}

btnSaveGlobal?.addEventListener("click", async () => {
  state.activeEnvironment = envSelect.value;
  state.defaultRewardedAdUnit = defaultAdUnitInput?.value?.trim() || "";
  state.adsenseClientId = globalAdsenseClientInput?.value?.trim() || "";
  state.adsenseTopSlot = globalAdsenseTopSlotInput?.value?.trim() || "";
  state.adsenseBottomSlot = globalAdsenseBottomSlotInput?.value?.trim() || "";
  state.r2AccountId = r2AccountIdInput?.value?.trim() || "";
  state.r2S3Endpoint = r2S3EndpointInput?.value?.trim() || "";
  state.r2AccessKeyId = r2AccessKeyIdInput?.value?.trim() || "";
  state.r2SecretAccessKey = r2SecretAccessKeyInput?.value?.trim() || "";
  state.runpodApiKey = runpodApiKeyInput?.value?.trim() || "";
  syncActiveEnvProfileFromInputs();
  await saveAllState(saveMsgGlobal);
});

btnSaveDetail?.addEventListener("click", async () => {
  if (currentServiceIdx === null) return;
  
  const s = state.services[currentServiceIdx];
  if (s) {
    s.enabled = detailSvcEnabled ? detailSvcEnabled.checked : true;
    s.adminOnly = detailSvcAdminOnly ? detailSvcAdminOnly.checked : false;
    s.rewardedAdUnit = detailSvcAdUnit ? detailSvcAdUnit.value.trim() : "";
    s.adsenseClientId = detailSvcAdsenseClient ? detailSvcAdsenseClient.value.trim() : "";
    s.adsenseTopSlot = detailSvcAdsenseTop ? detailSvcAdsenseTop.value.trim() : "";
    s.adsenseBottomSlot = detailSvcAdsenseBottom ? detailSvcAdsenseBottom.value.trim() : "";
  }
  
  await saveAllState(saveMsgDetail);
  
  setTimeout(() => {
    btnBackToList?.click();
  }, 1000);
});

function askConfirm() {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const okBtn = document.getElementById("btn-confirm-ok");
    const cancelBtn = document.getElementById("btn-confirm-cancel");
    if (!modal || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    modal.style.display = "flex";

    const cleanUp = (result) => {
      modal.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };

    const onOk = () => cleanUp(true);
    const onCancel = () => cleanUp(false);

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

const btnCleanupStorage = document.getElementById("btn-cleanup-storage");
const cleanupStatusMsg = document.getElementById("cleanup-status-msg");

// console.log("Admin cleanup script initialized. btn-cleanup-storage:", btnCleanupStorage);

btnCleanupStorage?.addEventListener("click", async () => {
  // console.log("Cleanup button clicked");
  // console.log("currentServiceIdx value:", currentServiceIdx);
  if (currentServiceIdx === null) {
    // console.log("Aborting cleanup: currentServiceIdx is null");
    return;
  }
  const s = state.services[currentServiceIdx];
  // console.log("Target service object:", s);
  if (!s) {
    // console.log("Aborting cleanup: service object is falsy");
    return;
  }

  // console.log("Triggering custom confirm modal...");
  const confirmed = await askConfirm();
  if (!confirmed) {
    // console.log("Cleanup cancelled by user in custom confirm modal");
    return;
  }
  // console.log("Confirm modal accepted, starting request...");

  const token = sessionStorage.getItem("info_admin_token");
  if (!token) {
    handleAuthError();
    return;
  }

  if (cleanupStatusMsg) cleanupStatusMsg.textContent = "정리 작업 진행 중...";
  try {
    const res = await fetch(`${API.replace(/\/$/, "")}/api/admin/services/${s.id}/cleanup`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      handleAuthError();
      return;
    }

    if (!res.ok) {
      if (cleanupStatusMsg) cleanupStatusMsg.textContent = `정리 실패: ${res.status}`;
      return;
    }

    const data = await res.json();
    const mbFreed = (data.freedBytes / (1024 * 1024)).toFixed(2);
    if (cleanupStatusMsg) {
      cleanupStatusMsg.textContent = `정리 완료! 모든 파일 ${data.deleted}개 삭제됨 (${mbFreed} MB 확보)`;
    }
  } catch (err) {
    if (cleanupStatusMsg) cleanupStatusMsg.textContent = "정리 중 오류가 발생했습니다.";
  }
});

checkAuth();
