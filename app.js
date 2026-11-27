import {googleBridge} from './pages-bridge.js';
import {createCamera} from './camera.js';
import {extractItemCode} from './ocr-code.js';
import {inventoryCsv,csvName} from './csv.js';

const $ = id => document.getElementById(id);
const titles = {home:'オンライン商品管理', manual:'在庫手動更新', scan:'連続SCAN',
  locations:'ロケーション管理', shipping:'発送管理', history:'処理履歴'};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normal = value => String(value).trim().toLowerCase().replace(/\s+/g,'');
const googleHost = typeof google !== 'undefined' && google.script?.run;
const pagesHost = Boolean(document.querySelector('meta[name="flamingo-pages"]'));
const bridge = pagesHost ? googleBridge() : null;
let connected = !pagesHost;
const selected = new Map();
const fmt = date => isNaN(Date.parse(date)) ? date : new Intl.DateTimeFormat('ja-JP',{
  timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short',
}).format(new Date(date));
let state, route, search = '', filter = '', draft = [], mode = 'off', busy = false;
let csvUrl;
let generation = 0, poll = 0, appliedPoll = 0;
const demoAccount = $('demo-store');
$('demo').hidden = Boolean(googleHost || pagesHost);
$('pages-connect').hidden = !pagesHost;
if (pagesHost) {
  const endpoint = $('gas-url');
  try { endpoint.value = localStorage.getItem('flamingo-test-gas') || ''; } catch {}
  $('pages-connect-form').onsubmit = async event => {
    event.preventDefault();
    const button = $('google-connect');
    if (button.disabled || busy) return;
    button.disabled = true;
    connected = false;
    generation++;
    state = null;
    selected.clear();
    draft = [];
    camera.stop();
    clearPreparedCsv();
    $('screen').replaceChildren();
    $('scan-list').replaceChildren();
    $('camera-panel').hidden = true;
    $('title').textContent = 'Googleへの接続を確認中…';
    try {
      await bridge.connect(endpoint.value.trim());
      try { localStorage.setItem('flamingo-test-gas',endpoint.value.trim()); } catch {}
      connected = true;
      await refresh();
      message('Googleに接続しました');
    } catch (error) {
      connected = false;
      message(error.message,true);
    } finally {
      button.disabled = false;
    }
  };
}

async function call(command,input = {}) {
  if (bridge) return bridge.request(command,input);
  if (googleHost) return new Promise((resolve,reject) => google.script.run
    .withSuccessHandler(resolve).withFailureHandler(reject).storeCall(command,input));
  const res = await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({demo:demoAccount.value,command,input})});
  const result = await res.json();
  if (!res.ok) throw Error(result.error);
  return result;
}

function message(text,error = false) {
  const node = $('message');
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('error',error);
}

function extractForStore(text) {
  const registered = new Set(state.locations.map(row => normal(row[0])));
  const original = extractItemCode(text);
  if (original && (registered.has(original) || !state.store.pattern)) return original;
  const compact = normal(text).replace(/[^a-z0-9]/g,'');
  const pattern = state.store.pattern;
  if (pattern) {
    try {
      if (original && new RegExp('^(?:'+pattern+')$','i').test(original)) return original;
      const candidates = [...new Set(compact.match(new RegExp(pattern,'gi')) || [])];
      if (candidates.length === 1) return candidates[0];
      const matched = candidates.filter(code => registered.has(code));
      if (matched.length === 1) return matched[0];
    } catch { /* Master pattern errors leave registered-code matching available. */ }
  }
  const candidates = [...registered].filter(code => /^[a-z0-9]{6,}$/.test(code));
  const exact = candidates.filter(code => compact.includes(code));
  if (exact.length) return exact.length === 1 ? exact[0] : '';
  const equivalents = {'0':'[0o]','1':'[1il]','2':'[2z]','5':'[5s]','8':'[8b]'};
  const corrected = candidates.filter(code => new RegExp(Array.from(code, char => equivalents[char] || char).join('')).test(compact));
  return corrected.length === 1 ? corrected[0] : '';
}

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem('scan:'+state.store.id) || '[]'); }
  catch { return []; }
}
function drawDraft() {
  $('scan-list').innerHTML = draft.map((code,i) => '<li><div class="row-between"><code>'+escapeHtml(code)+
    '</code><div class="actions"><button class="secondary" data-act="scan-edit" data-id="'+i+'">修正</button>'+
    '<button class="secondary" data-act="scan-remove" data-id="'+i+'">削除</button></div></div></li>').join('');
  $('save-scan').disabled = busy || !draft.length;
  try { sessionStorage.setItem('scan:'+state.store.id,JSON.stringify(draft)); } catch {}
}

const camera = createCamera({
  video:$('video'), motionCanvas:$('motion'), ocrCanvas:$('ocr'),
  status:text => { $('camera-status').textContent = text; },
  extract:extractForStore,
  loadAssets:googleHost ? loadEmbeddedOcrAssets : undefined,
  assetBase:googleHost ? undefined : new URL('./vendor/',location.href).href,
  onMode:value => {
    mode = value;
    $('preview').hidden = value === 'off';
    $('start').disabled = value !== 'off';
    $('pause').disabled = !['running','paused'].includes(value);
    $('pause').textContent = value === 'paused' ? '再開' : '一時停止';
    $('stop').disabled = value === 'off';
    $('rescan').disabled = value === 'off' || value === 'loading';
  },
  onError:text => message(text,true),
  accept:code => {
    if (draft.includes(code) || state.queue.some(row => row[1] === code)) {
      $('camera-status').textContent = '登録済み：'+code;
      return false;
    }
    if (draft.length >= 60) {
      $('camera-status').textContent = '60件を蓄積してから読み取りを再開してください';
      return false;
    }
    draft.push(code);
    drawDraft();
    return true;
  },
});
$('ocr-test').hidden = !googleHost;
$('ocr-test').onclick = async () => {
  const button = $('ocr-test');
  const result = $('ocr-test-result');
  button.disabled = true;
  result.hidden = false;
  result.textContent = 'ダミー画像を認識中…';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 340;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 90px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('M20261126',500,135);
    ctx.fillText('M002',500,250);
    const code = extractItemCode(await camera.recognizeTestImage(canvas));
    result.textContent = code === 'm20261126m002' ? 'OCR確認成功：'+code : 'OCR確認画像を読み取れませんでした。';
  } catch (error) {
    result.textContent = 'OCR確認エラー：'+(error.message || String(error));
  } finally {
    button.disabled = false;
  }
};

function clearPreparedCsv() {
  if (csvUrl) URL.revokeObjectURL(csvUrl);
  csvUrl = undefined;
  $('csv-ready').hidden = true;
  $('csv-download').removeAttribute('href');
}

$('start').onclick = () => camera.start();
$('pause').onclick = () => camera.pause();
$('stop').onclick = () => camera.stop();
$('rescan').onclick = () => {
  if (!draft.length || busy) return;
  draft.pop(); drawDraft(); camera.rearm();
};
addEventListener('pagehide',() => camera.stop());

const action = (label,act,id='',cls='secondary') =>
  '<button type="button" class="'+cls+'" data-act="'+act+'" data-id="'+escapeHtml(id)+'">'+label+'</button>';
const panel = content => '<div class="panel">'+content+'</div>';
const input = (name,value = '') => '<input name="'+name+'" value="'+escapeHtml(value)+'" autocomplete="off">';
const statusTag = status => '<span class="flag '+(status === '発送可能' ? '' : 'hold')+'">'+escapeHtml(status)+'</span>';

function render() {
  if (!state) return;
  $('store').textContent = state.store.name+'店 ／ ダミーテスト';
  $('title').textContent = titles[route];
  $('camera-panel').hidden = route !== 'scan';
  const screen = $('screen');
  if (route === 'home') {
    const possible = state.shipments.filter(order => order.status === '発送可能').length;
    screen.innerHTML = '<div class="grid stats"><a class="card stat" href="#shipping">発送可能<strong>'+possible+
      '件</strong></a><a class="card stat" href="#shipping">発送保留<strong>'+(state.shipments.length-possible)+
      '件</strong></a></div><nav class="grid" aria-label="業務メニュー">'+Object.entries(titles).slice(1)
      .map(([id,label]) => '<a class="card" href="#'+id+'"><strong>'+label+'</strong></a>').join('')+'</nav>';
  }
  if (route === 'manual' || route === 'scan') {
    if (route === 'scan') drawDraft();
    screen.innerHTML = panel('<form id="add-form"><label for="product-code">品番</label><div class="actions">'+
      '<input id="product-code" name="code" required autocomplete="off"><button>リストに追加</button></div></form>')+
      panel('<h2>在庫変更リスト</h2><div class="actions">'+action('全選択','all')+action('選択解除','none')+
      action('選択分のCSV','csv','','')+'</div><p class="muted">CSVはfutureshop管理画面で手動アップロードします。出力後も品番は一覧に残ります。</p>'+
      (state.queue.length ? state.queue.map(row => '<div class="row-between"><label class="inline">'+
        '<input type="checkbox" data-select="'+escapeHtml(row[0])+'" '+(selected.has(row[0]) ? 'checked' : '')+'>'+
        '<code>'+escapeHtml(row[1])+'</code> '+escapeHtml(row[2])+'</label>'+
        '<div class="actions">'+action('修正','edit',row[0])+action('削除','remove',row[0])+'</div>'+
        (row[6] ? '<p class="comment">'+escapeHtml(row[6])+'</p>' : '')+'</div>').join('') : '<p>蓄積された品番はありません。</p>'));
  }
  if (route === 'locations') {
    const matches = state.locations.filter(row => row.join(' ').toLowerCase().includes(search.toLowerCase()));
    screen.innerHTML = panel('<form id="location-search"><label for="search-code">品番・ロケーション・コメントで検索</label>'+
      '<div class="actions"><input id="search-code" name="query" value="'+escapeHtml(search)+'"><button>検索</button></div></form>')+
      (matches.length ? matches.map(([code,loc,comment]) => panel('<form class="location-edit" data-code="'+escapeHtml(code)+'">'+
        '<h2>'+escapeHtml(code)+'</h2><label>ロケーション番号 '+input('location',loc)+'</label>'+
        '<label>コメント '+input('comment',comment)+'</label><div class="actions"><button>保存</button></div></form>')).join('') :
        panel('<p>該当する品番がありません。</p>'));
  }
  if (route === 'shipping') screen.innerHTML = state.shipments.length ? state.shipments.map(order => {
    const header = order.items.find(item => item.surname || item.given) || order.items[0];
    return panel('<div class="row-between"><h2>'+escapeHtml(order.id)+'</h2>'+statusTag(order.status)+'</div>'+
      '<p>'+escapeHtml([header.surname,header.given,header.postal,header.region,header.payment].filter(Boolean).join(' ／ '))+'</p>'+
      '<p class="muted">'+escapeHtml([header.date,header.desiredDate,header.desiredTime].filter(Boolean).join(' ／ '))+'</p>'+
      order.items.map(item => '<div><strong>'+escapeHtml(item.name)+'</strong><p><code>'+escapeHtml(item.code)+
        '</code> ／ '+escapeHtml(item.location)+'</p>'+(item.productSearch ? '<p class="muted">'+escapeHtml(item.productSearch)+'</p>' : '')+(item.comment ? '<p class="comment">'+escapeHtml(item.comment)+'</p>' : '')+'</div>').join('')+
      '<button type="button" data-act="ship" data-id="'+escapeHtml(order.id)+'" '+(order.status !== '発送可能' ? 'disabled' : '')+'>発送完了</button>');
  }).join('') : panel('<p>発送待ちはありません。</p>');
  if (route === 'history') {
    const rows = state.history.filter(row => !filter || row[2] === filter);
    screen.innerHTML = panel('<label for="history-filter">表示する処理</label><select id="history-filter">'+
      ['', '在庫更新','発送完了'].map(value => '<option value="'+value+'" '+(value === filter ? 'selected' : '')+'>'+
        (value || 'すべて')+'</option>').join('')+'</select>')+
      (rows.length ? rows.map(row => panel('<h2>'+escapeHtml(row[2])+' ／ '+escapeHtml(row[3])+'</h2><p>'+
        escapeHtml(fmt(row[0]))+' ／ '+escapeHtml(row[5])+'件</p><p>'+escapeHtml(row[4])+'</p>'+
        '<p class="result">'+escapeHtml(row.slice(6,10).filter(Boolean).join('\n'))+'</p>')).join('') : panel('<p>処理履歴はありません。</p>'));
  }
}

async function refresh({quiet = false} = {}) {
  const current = generation;
  const sequence = ++poll;
  const data = await call('get');
  if (current !== generation || sequence < appliedPoll) return;
  appliedPoll = sequence;
  const paint = !quiet || !state || JSON.stringify(state.shipments) !== JSON.stringify(data.shipments);
  if (quiet && !paint) return;
  const changedStore = state?.store.id !== data.store.id;
  state = data;
  if (changedStore) draft = readDraft();
  for (const [id,version] of selected) if (!state.queue.some(row => row[0] === id && row[5] === version)) selected.delete(id);
  render();
}

async function run(command,input,after) {
  if (busy) return;
  busy = true;
  $('screen').setAttribute('aria-busy','true');
  demoAccount.disabled = true;
  drawDraft();
  message('処理中…');
  try {
    const result = await call(command,input);
    if (after) after(result);
    if (command !== 'csv') await refresh();
    message(result.message || ((googleHost || pagesHost) ? 'CSVを作成しました。ダウンロードをタップしてください。' : 'CSVをダウンロードしました。品番は一覧に残ります。'));
  } catch (error) {
    message(error.message || String(error),true);
    await refresh().catch(() => {});
  } finally {
    $('screen').removeAttribute('aria-busy');
    busy = false;
    demoAccount.disabled = false;
    drawDraft();
  }
}

$('save-scan').onclick = () => {
  camera.stop();
  const snapshot = draft.slice();
  run('add',{codes:snapshot,source:'SCAN'},() => { draft = draft.filter(code => !snapshot.includes(code)); });
};

document.addEventListener('submit', event => {
  const form = event.target;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'add-form') run('add',{codes:[data.code],source:'手動'});
  if (form.id === 'location-search') { search = data.query; render(); }
  if (form.classList.contains('location-edit')) run('location',{...data,code:form.dataset.code});
});
document.addEventListener('change',event => {
  const node = event.target;
  if (node.id === 'history-filter') { filter = node.value; render(); }
  if (node.dataset.select) {
    const row = state.queue.find(item => item[0] === node.dataset.select);
    if (node.checked && row) selected.set(row[0],row[5]);
    else selected.delete(node.dataset.select);
  }
});
document.addEventListener('click',event => {
  const button = event.target.closest('[data-act]');
  if (!button || busy) return;
  const {act,id} = button.dataset;
  const row = state.queue.find(item => item[0] === id);
  if (act === 'scan-edit') {
    const value = prompt('品番を修正',draft[Number(id)]);
    if (value === null) return;
    const code = normal(value);
    if (!code || draft.some((item,i) => i !== Number(id) && item === code)) { message('品番または重複を確認してください',true); return; }
    draft[Number(id)] = code; drawDraft();
  }
  if (act === 'scan-remove') { draft.splice(Number(id),1); drawDraft(); }
  if (act === 'all' || act === 'none') {
    selected.clear();
    if (act === 'all') for (const row of state.queue) selected.set(row[0],row[5]);
    render();
  }
  if (act === 'edit' && row) {
    const code = prompt('品番を修正',row[1]);
    if (code !== null) run('edit',{id,version:row[5],code});
  }
  if (act === 'remove' && row && confirm(row[1]+' を取り消しますか？')) run('remove',{id,version:row[5]});
  if (act === 'ship' && confirm(id+' を自店舗の発送完了として記録しますか？')) run('ship',{order:id});
  if (act === 'csv') {
    const items = Array.from(selected,([id,version]) => ({id,version}));
    if (!items.length) { message('対象品番を選択してください',true); return; }
    clearPreparedCsv();
    run('csv',{items},result => {
      const bytes = pagesHost ? Uint8Array.from(atob(result.base64), char => char.charCodeAt(0)) : inventoryCsv(result.codes);
      const url = URL.createObjectURL(new Blob([bytes],{type:'text/csv;charset=Shift_JIS'}));
      if (googleHost || pagesHost) {
        csvUrl = url;
        const link = $('csv-download');
        link.href = url;
        link.download = pagesHost ? result.filename : csvName();
        $('csv-ready').hidden = false;
        return;
      }
      const link = document.createElement('a');
      link.href = url; link.download = csvName();
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),5000);
    });
  }
});

function navigate() {
  const key = location.hash.slice(1);
  route = Object.prototype.hasOwnProperty.call(titles,key) ? key : 'home';
  camera.stop();
  clearPreparedCsv();
  render();
  if (connected && !busy) refresh().catch(error => message(error.message,true));
  if (!connected) $('title').textContent = 'Googleに接続してください';
}
demoAccount.onchange = () => {
  generation++;
  state = null;
  search = '';
  selected.clear();
  $('screen').replaceChildren();
  $('camera-panel').hidden = true;
  navigate();
};
addEventListener('hashchange',navigate);
setInterval(() => {
  if (state && !busy && (route === 'home' || route === 'shipping')) refresh({quiet:true}).catch(error => message(error.message,true));
},8000);
navigate();
