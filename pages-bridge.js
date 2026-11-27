const protocol = 'flamingo-v2-test';
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2,'0')).join('');

export function googleBridge() {
  let active;
  function close(reason) {
    if (!active) return;
    const current = active;
    active = undefined;
    clearTimeout(current.timer);
    current.popup.close();
    if (!current.peer) current.reject(Error(reason));
    for (const request of current.pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error(reason));
    }
  }
  window.addEventListener('message',event => {
    const current = active;
    const received = event.data;
    if (!current || !received || received.protocol !== protocol || received.nonce !== current.nonce || !event.source) return;
    if (!current.peer) {
      if (received.type !== 'ready' || event.source.top !== current.popup ||
          !/^https:\/\/(?:script\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/.test(event.origin)) return;
      current.peer = event.source;
      current.origin = event.origin;
      clearTimeout(current.timer);
      current.resolve();
      return;
    }
    if (event.source !== current.peer || event.origin !== current.origin || received.type !== 'result') return;
    const request = current.pending.get(received.id);
    if (!request) return;
    current.pending.delete(received.id);
    clearTimeout(request.timer);
    if (received.ok === true) request.resolve(received.result);
    else request.reject(Error(received.error || 'GASで操作を完了できませんでした'));
  });
  return {
    connect(endpoint) {
      const url = new URL(endpoint);
      if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[a-z0-9_-]+\/exec$/i.test(url.pathname) ||
          url.search || url.hash || url.username || url.password) throw Error('新規テスト用GASの /exec URLを入力してください');
      close('Googleへ再接続しています');
      const nonce = randomId();
      url.searchParams.set('mode','pages');
      url.searchParams.set('state',nonce);
      const popup = window.open(url.href,'_blank');
      if (!popup) throw Error('Safariで別タブを開けません。ポップアップ設定を確認してください');
      return new Promise((resolve,reject) => {
        active = {nonce,popup,resolve,reject,pending:new Map(),
          timer:setTimeout(() => close('GASから応答がありません。Google認証後に戻り、もう一度接続してください'),90000)};
      });
    },
    request(command,input) {
      const current = active;
      if (!current?.peer || current.popup.closed) return Promise.reject(Error('Googleに再接続してください'));
      const id = randomId();
      return new Promise((resolve,reject) => {
        const timer = setTimeout(() => {
          current.pending.delete(id);
          reject(Error('GASから応答がありません。通信状況と処理履歴を確認してください'));
        },30000);
        current.pending.set(id,{resolve,reject,timer});
        current.peer.postMessage({protocol,type:'request',nonce:current.nonce,id,command,input},current.origin);
      });
    },
    close,
  };
}
