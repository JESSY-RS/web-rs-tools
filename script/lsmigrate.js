(function () {
  'use strict';

  // ▼ 移行元（GitHub Pages）の橋渡しページのURL ▼
  const BRIDGE_URL = 'https://jessy-rs.github.io/web-rs-tools/lsbridge.html';
  const BRIDGE_ORIGIN = 'https://jessy-rs.github.io';

  // 一度成功、または手動で「非表示にする」を選んだら、以降は表示しないためのフラグ
  const DONE_FLAG_KEY = '__lsmigrate_done__';

  // ポップアップ準備待ちのリトライ間隔・最大回数（250ms x 20 = 5秒でタイムアウト）
  const RETRY_INTERVAL_MS = 250;
  const MAX_RETRIES = 20;

  function markDone() {
    try {
      localStorage.setItem(DONE_FLAG_KEY, String(Date.now()));
    } catch (e) {
      // ストレージが使えない環境では諦める
    }
  }

  // ▼ lsbridge.html の「旧サイトの設定を引き継ぐボタンを非表示にする」から、
  //   ただのページ遷移（?__lsmigrate_dismiss=1）で伝えられてくる合図を処理する。
  //   postMessageやポップアップのopener関係に依存しないため、アプリ内ブラウザでも確実に動く。 ▼
  (function handleDismissParam() {
    const params = new URLSearchParams(location.search);
    if (params.get('__lsmigrate_dismiss') !== '1') return;

    markDone();

    // URLからパラメータを消して見た目を綺麗にする（対応していない環境では何もしない）
    try {
      params.delete('__lsmigrate_dismiss');
      const newSearch = params.toString();
      const newUrl = location.pathname + (newSearch ? '?' + newSearch : '') + location.hash;
      window.history.replaceState(null, '', newUrl);
    } catch (e) {
      // 無視（見た目だけの問題なので動作には影響しない）
    }
  })();

  function importData(incoming) {
    let importedCount = 0;
    Object.keys(incoming || {}).forEach((key) => {
      // 新サイト側に既に同名のキーがある場合は、そちらを優先して上書きしない
      if (localStorage.getItem(key) === null) {
        try {
          localStorage.setItem(key, incoming[key]);
          importedCount++;
        } catch (e) {
          // 容量超過などは無視して続行
        }
      }
    });
    return importedCount;
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '旧サイトの設定を引き継ぐ';
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
    btn.textContent = '旧サイトの設定を引き継ぐ';
  }

  function startMigration(btn) {
    // ▼ ユーザーのクリック（ジェスチャー）の中で同期的に呼ぶ必要がある ▼
    const popup = window.open(
      BRIDGE_URL,
      'lsmigrate_popup',
      'width=420,height=280'
    );

    if (!popup) {
      alert('ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してから、もう一度お試しください。\n\nうまくいかない場合は、開いたページの「旧サイトの設定を引き継ぐボタンを非表示にする」ボタンをお使いください。');
      return;
    }

    btn.disabled = true;
    btn.textContent = '引き継ぎ中...';

    let finished = false;
    let retryTimer = null;

    function cleanup() {
      window.removeEventListener('message', handleMessage);
      if (retryTimer) clearInterval(retryTimer);
      try {
        if (!popup.closed) popup.close();
      } catch (e) {
        // クロスオリジンでcloseできない場合は無視（通常は自分で開いた窓なので閉じられる）
      }
    }

    function handleMessage(event) {
      if (finished) return;
      if (event.source !== popup) return;
      if (event.origin !== BRIDGE_ORIGIN) return;
      if (!event.data || event.data.type !== 'LOCALSTORAGE_DATA') return;

      finished = true;
      const importedCount = importData(event.data.data);
      markDone();
      console.log('[lsmigrate] 旧サイトから ' + importedCount + ' 件のデータを引き継ぎました。');
      cleanup();

      if (btn.parentNode) btn.parentNode.removeChild(btn);

      if (importedCount > 0) {
        // 表示倍率など、読み込み時にしか反映されない設定があるためリロードして反映
        location.reload();
      }
    }

    window.addEventListener('message', handleMessage);

    // ポップアップ側の読み込みタイミングが読めないため、準備できるまで定期的に要求を送る
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
      } catch (e) {
        // まだ読み込み中の場合など。次のリトライに任せる。
      }
      if (attempts >= MAX_RETRIES) {
        clearInterval(retryTimer);
        if (!finished) {
          cleanup();
          resetButton(btn);
          alert('データの取得に失敗しました。ポップアップを閉じずにしばらく待ってから、もう一度お試しください。\n\nうまくいかない場合は、開いたページの「旧サイトの設定を引き継ぐボタンを非表示にする」ボタンをお使いください。');
        }
      }
    }, RETRY_INTERVAL_MS);
  }

  function init() {
    if (localStorage.getItem(DONE_FLAG_KEY)) return; // 既に移行済み、または非表示済みなら何もしない
    if (!window.postMessage || !document.body) return; // 万一bodyがまだ無ければ諦める（次回アクセス時に再試行）

    const button = createButton();
    button.addEventListener('click', function () {
      startMigration(button);
    });
    document.body.appendChild(button);
  }

  // <head>内で同期実行される想定のため、bodyがまだ無ければDOMContentLoadedまで待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
