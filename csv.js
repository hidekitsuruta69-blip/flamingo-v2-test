const headerBytes = new Uint8Array([131, 82, 131, 147, 131, 103, 131, 141, 129, 91, 131, 139, 131, 74, 131, 137, 131, 128, 44, 143, 164, 149, 105, 85, 82, 76, 131, 82, 129, 91, 131, 104, 44, 143, 164, 149, 105, 148, 212, 141, 134, 44, 143, 164, 149, 105, 150, 188, 44, 140, 187, 141, 221, 141, 221, 140, 201, 144, 148, 44, 146, 178, 144, 174, 141, 221, 140, 201, 144, 148, 44, 141, 221, 140, 201, 144, 148, 144, 216, 130, 234, 131, 129, 129, 91, 131, 139, 232, 135, 146, 108, 44, 141, 197, 143, 73, 141, 88, 144, 86, 147, 250, 142, 158]);

export function escapeCsv(value) {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

export function inventoryCsv(codes) {
  if (!codes.length) throw new Error('出力する在庫変更待ちがありません');
  const rows = codes.map(code => ['',code,'','','','0','',''].map(escapeCsv).join(','));
  const body = '\r\n' + rows.join('\r\n');
  if (/[^\x00-\x7f]/.test(body)) throw new Error('CSVに対応していない品番が含まれます');
  const bytes = new Uint8Array(headerBytes.length + body.length);
  bytes.set(headerBytes);
  bytes.set(new TextEncoder().encode(body), headerBytes.length);
  return bytes;
}

export function csvName(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({type,value}) => [type,value]));
  return 'goodsStock_' + p.year + p.month + p.day + '-' + p.hour + p.minute + p.second + '.csv';
}
