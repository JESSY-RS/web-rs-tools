(function () {
  'use strict';

  // ▼ 移行元（Cloudflare Pages / 運用終了予定サイト）の橋渡しページのURL ▼
  // ※ pages.dev を完全に閉鎖するまでは、このブリッジファイルだけは生かしておくこと
  const BRIDGE_URL = 'https://web-rs-apps.pages.dev/lsbridge-back.html';
  const BRIDGE_ORIGIN = 'https://web-rs-apps.pages.dev';

  // forward版（__lsmigrate_done__）とは別キーにして衝突を避ける
  const DONE_FLAG_KEY = '__lsmigrate_back_done__';
  const INTERNAL_KEY_PREFIX = '__lsmigrate';

  const RETRY_INTERVAL_MS = 250;
  const MAX_RETRIES = 20;

  function markDone() {
    try {
      localStorage.setItem(DONE_FLAG_KEY, String(Date.now()));
    } catch (e) {}
  }

  // ▼ forward版と異なり「上書き」を行う。pages.dev運用中に変更された設定を正として扱うため ▼
  function importDataOverwrite(incoming) {
    let updatedCount = 0;
    Object.keys(incoming || {}).forEach((key) => {
      if (key.indexOf(INTERNAL_KEY_PREFIX) === 0) return; // 内部フラグは取り込まない
      try {
        localStorage.setItem(key, incoming[key]);
        updatedCount++;
      } catch (e) {
        // 容量超過などは無視して続行
      }
    });
    return updatedCount;
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '新サイトで使っていた設定を反映する';
    btn.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'padding:10px 16px',
      'background:#1D9BF0',
      'color:#fff',
      'border:none',
      'border-radius:999px',
      'font-size:13px',
      'line-height:1.4',
      'font-family:sans-serif',
      'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
      'cursor:pointer'
    ].join(';');
    return btn;
  }

  function resetButton(btn) {
    btn.disabled = false;
    btn.textContent = '新サイトで使っていた設定を反映する';
  }

  function startMigration(btn) {
    // 上書きなので、実行前に一度だけ確認する
    const ok = confirm(
      'このブラウザに保存されている今のサイトの設定を、以前 web-rs-apps.pages.dev で使っていた内容で上書きします。よろしいですか？'
    );
    if (!ok) return;

    const popup = window.open(BRIDGE_URL, 'lsmigrate_back_popup', 'width=420,height=280');

    if (!popup) {
      alert('ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してから、もう一度お試しください。');
      return;
    }

    btn.disabled = true;
    btn.textContent = '反映中...';

    let finished = false;
    let retryTimer = null;

    function cleanup() {
      window.removeEventListener('message', handleMessage);
      if (retryTimer) clearInterval(retryTimer);
      try {
        if (!popup.closed) popup.close();
      } catch (e) {}
    }

    function handleMessage(event) {
      if (finished) return;
      if (event.source !== popup) return;
      if (event.origin !== BRIDGE_ORIGIN) return;
      if (!event.data || event.data.type !== 'LOCALSTORAGE_DATA') return;

      finished = true;
      const updatedCount = importDataOverwrite(event.data.data);
      markDone();
      console.log('[lsmigrate-back] pages.dev から ' + updatedCount + ' 件の設定を反映しました。');
      cleanup();

      if (btn.parentNode) btn.parentNode.removeChild(btn);

      if (updatedCount > 0) {
        location.reload();
      } else {
        alert('反映できる設定が見つかりませんでした。');
      }
    }

    window.addEventListener('message', handleMessage);

    let attempts = 0;
    retryTimer = setInterval(function () {
      if (finished) {
        clearInterval(retryTimer);
        return;
      }
      if (popup.closed) {
        clearInterval(retryTimer);
        cleanup();
        resetButton(btn);
        return;
      }
      attempts++;
      try {
        popup.postMessage({ type: 'REQUEST_LOCALSTORAGE' }, BRIDGE_ORIGIN);
      } catch (e) {}
      if (attempts >= MAX_RETRIES) {
        clearInterval(retryTimer);
        if (!finished) {
          cleanup();
          resetButton(btn);
          alert('データの取得に失敗しました。もう一度お試しください。');
        }
      }
    }, RETRY_INTERVAL_MS);
  }

  function init() {
    if (localStorage.getItem(DONE_FLAG_KEY)) return;
    if (!window.postMessage || !document.body) return;

    const button = createButton();
    button.addEventListener('click', function () {
      startMigration(button);
    });
    document.body.appendChild(button);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
