import {
  fetchPublicConfig,
  resolveApiBase,
  injectAdSense,
} from "@infotools/web-sdk";

const API = import.meta.env.VITE_API_BASE_URL || "";

async function apiBase() {
  const cfg = await fetchPublicConfig(API || window.location.origin);
  return resolveApiBase(cfg, API || "http://127.0.0.1:19427");
}

let allServices = [];

function renderServices(services) {
  const grid = document.getElementById("tool-grid");
  if (!grid) return;
  if (services.length === 0) {
    grid.innerHTML = `<p style="color:var(--muted); text-align:center; grid-column:1/-1; margin:3rem 0; font-size:0.95rem;">검색 결과가 없습니다.</p>`;
    return;
  }
  grid.innerHTML = services
    .map(
      (s) => `
    <a class="card" href="${s.sitePath || "#"}">
      <div class="card-header">
        <div class="card-icon">${s.icon || "✨"}</div>
        <div class="card-badge">${s.badge || "AI"}</div>
      </div>
      <h2>${s.name || s.nameKo}</h2>
      <div class="card-tags">${s.tags || s.nameKo || ""}</div>
      <p>${s.description || ""}</p>
      <div class="card-action">도구 열기 →</div>
    </a>`,
    )
    .join("");
}

async function init() {
  const envBadge = document.getElementById("env-badge");
  const healthDot = document.getElementById("health-dot");
  const healthText = document.getElementById("health-text");
  const searchInput = document.getElementById("search-input");
  const searchBtn = document.getElementById("search-btn");

  try {
    const base = await apiBase();
    const cfg = await fetchPublicConfig(base);
    envBadge.textContent = `환경: ${cfg.activeEnvironment || "local-mock"}`;
    injectAdSense(cfg, null);

    if (cfg.activeEnvironment === "production") {
      envBadge.style.display = "none";
      const footer = document.querySelector(".footer");
      if (footer) footer.style.display = "none";
    }

    const health = await fetch(`${base}/health`);
    if (health.ok) {
      healthDot.classList.add("ok");
      healthText.textContent = "Mock API 연결됨";
    }

    allServices = (cfg.services || []).filter((s) => s.enabled !== false);
    renderServices(allServices);

    const handleSearch = () => {
      const q = searchInput?.value?.trim()?.toLowerCase() || "";
      const filtered = allServices.filter((s) => {
        const name = (s.name || "").toLowerCase();
        const nameKo = (s.nameKo || "").toLowerCase();
        const tags = (s.tags || "").toLowerCase();
        return name.includes(q) || nameKo.includes(q) || tags.includes(q);
      });
      renderServices(filtered);
    };

    searchInput?.addEventListener("input", handleSearch);
    searchBtn?.addEventListener("click", handleSearch);

  } catch (err) {
    envBadge.textContent = "환경: 오프라인";
    healthText.textContent = err instanceof Error ? err.message : String(err);
    const grid = document.getElementById("tool-grid");
    if (grid) {
      grid.innerHTML = `<p style="color:#f87171">API에 연결할 수 없습니다. <code>npm run dev</code>로 mock-infra를 시작하세요.</p>`;
    }
  }
}

void init();

