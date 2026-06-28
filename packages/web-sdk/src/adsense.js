/**
 * Google AdSense 동적 스크립트 및 광고 뱃지 삽입 엔진
 * 
 * @param {import('./types.js').PublicConfig | null} config
 * @param {string | null} [serviceId]
 */
export function injectAdSense(config, serviceId = null) {
  if (!config) return;

  let clientId = "";
  let topSlot = "";
  let bottomSlot = "";

  // 1. 서비스 개별 정보 조회
  if (serviceId) {
    const services = config.services || [];
    const svc = services.find((s) => s.id === serviceId);
    if (svc) {
      clientId = svc.adsenseClientId?.trim() || "";
      topSlot = svc.adsenseTopSlot?.trim() || "";
      bottomSlot = svc.adsenseBottomSlot?.trim() || "";
    }
  }

  // 2. 개별 설정이 없으면 글로벌 공통 설정 폴백 적용 (우선순위: 개별 1순위, 전체 2순위)
  if (!clientId) clientId = config.adsenseClientId?.trim() || "";
  if (!topSlot) topSlot = config.adsenseTopSlot?.trim() || "";
  if (!bottomSlot) bottomSlot = config.adsenseBottomSlot?.trim() || "";

  // 3. Client ID가 있다면 헤더에 애드센스 라이브러리 비동기 삽입
  if (clientId) {
    const scriptSrc = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
    let script = document.querySelector(`script[src^="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]`);
    
    if (!script) {
      script = document.createElement("script");
      script.async = true;
      script.src = scriptSrc;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    } else {
      script.src = scriptSrc;
    }
  }

  // 4. 상단 광고 배너 영역 렌더링
  const topAdContainer = document.getElementById("top-ad-container");
  if (topAdContainer) {
    if (clientId && topSlot) {
      topAdContainer.innerHTML = `
        <ins class="adsbygoogle"
             style="display:block;width:100%"
             data-ad-client="${clientId}"
             data-ad-slot="${topSlot}"
             data-ad-format="auto"
             data-full-width-responsive="true"></ins>
      `;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        console.warn("AdSense top push error:", err);
      }
    } else {
      topAdContainer.innerHTML = `<p>상단 광고 영역</p>`;
    }
  }

  // 5. 하단 광고 배너 영역 렌더링
  const bottomAdContainer = document.getElementById("bottom-ad-container");
  if (bottomAdContainer) {
    if (clientId && bottomSlot) {
      bottomAdContainer.innerHTML = `
        <ins class="adsbygoogle"
             style="display:block;width:100%"
             data-ad-client="${clientId}"
             data-ad-slot="${bottomSlot}"
             data-ad-format="auto"
             data-full-width-responsive="true"></ins>
      `;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        console.warn("AdSense bottom push error:", err);
      }
    } else {
      bottomAdContainer.innerHTML = `<p>하단 광고 영역</p>`;
    }
  }
}
