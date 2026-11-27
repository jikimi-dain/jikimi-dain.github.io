/**
 * 放下着 JIKIMi ↔ 구글 캘린더 연결 프로그램 (구글 앱스 스크립트)
 * 지킴이님 구글 계정 안에서만 돌아요. 지킴이 앱이 이 주소로 일정을 넣고·고치고·지우고·가져가요.
 * 삼성 캘린더는 휴대폰에서 구글 계정과 동기화돼 있으면 같이 보여요.
 *
 * 앱에서 보내는 것 (POST, 본문은 JSON 글자):
 *   {key, action:'ping'}                                   → {ok, calendar, tz}
 *   {key, action:'list', from:'2026-09-01', to:'2027-12-31'} → {ok, events:[{gid,title,date,time,endTime,allDay,desc,updated,appId}]}
 *   {key, action:'upsert', appId, gid?, title, date, time?, desc?} → {ok, gid, updated}
 *   {key, action:'delete', gid}                            → {ok}
 *   {key, action:'batch', ops:[...위 upsert/delete...]}    → {ok, results:[...]}
 */

// ▼ 아래 열쇠는 지킴이 앱 설정에도 똑같이 넣어요 (다른 사람이 주소만 알아서는 못 쓰게)
const KEY = 'YOUR-KEY';
const TAG = 'jikimiId';            // 지킴이에서 넣은 일정에 붙이는 이름표
const TZ = 'Asia/Seoul';

function cal_() { return CalendarApp.getDefaultCalendar(); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function hm_(d) { return Utilities.formatDate(d, TZ, 'HH:mm'); }
function parseDay_(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function parseAt_(date, time) { const d = parseDay_(date), t = String(time).split(':').map(Number); d.setHours(t[0] || 0, t[1] || 0, 0, 0); return d; }

function evJson_(e) {
  const all = e.isAllDayEvent(), st = e.getStartTime(), en = e.getEndTime();
  return {
    gid: e.getId(), title: e.getTitle(), date: ymd_(st), time: all ? '' : hm_(st), endTime: all ? '' : hm_(en),
    allDay: all, desc: e.getDescription() || '', updated: e.getLastUpdated().getTime(),
    appId: e.getTag(TAG) || '', recurring: e.isRecurringEvent()
  };
}

function upsert_(o) {
  const c = cal_(), title = String(o.title || '일정').slice(0, 300), desc = String(o.desc || '');
  const timed = /^\d{1,2}:\d{2}$/.test(o.time || '');
  let e = null;
  if (o.gid) { try { e = c.getEventById(o.gid); } catch (err) { e = null; } }
  if (e) {
    e.setTitle(title); e.setDescription(desc);
    if (timed) { const st = parseAt_(o.date, o.time); e.setTime(st, new Date(st.getTime() + 36e5)); }
    else e.setAllDayDate(parseDay_(o.date));
  } else {
    if (timed) { const st = parseAt_(o.date, o.time); e = c.createEvent(title, st, new Date(st.getTime() + 36e5), { description: desc }); }
    else e = c.createAllDayEvent(title, parseDay_(o.date), { description: desc });
  }
  // 2026-10-15 지킴이님: 공모주는 정한 시각(청약 오후 3:05 · 상장 오전 8:51 · 환불 오후 2:10)에 바로 알림 — 캘린더 기본 알림(하루 종일 일정이면 전날 밤 11:50)을 지우고 0분 전 팝업 하나만
  // 2026-10-20 지킴이님: 공모주가 아닌 하루 종일 일정도 기본 알림(전날 밤 11:50)을 지움
  if ((o.rem == null || o.rem === '') && !timed) o.rem = 'none';
  if (o.rem != null && o.rem !== '') { try { e.removeAllReminders(); if (o.rem !== 'none') e.addPopupReminder(Number(o.rem) || 0); } catch (err) {} }
  if (o.appId) e.setTag(TAG, String(o.appId));
  return { ok: true, gid: e.getId(), updated: e.getLastUpdated().getTime(), appId: o.appId || '' };
}

function del_(o) {
  try { const e = cal_().getEventById(o.gid); if (e) e.deleteEvent(); return { ok: true, gid: o.gid }; }
  catch (err) { return { ok: false, gid: o.gid, error: String(err) }; }
}

function handle_(o) {
  if (!o || o.key !== KEY) return { ok: false, error: 'key' };
  switch (o.action) {
    case 'ping': return { ok: true, calendar: cal_().getName(), tz: TZ };
    case 'list': {
      const from = parseDay_(o.from), to = parseDay_(o.to); to.setDate(to.getDate() + 1);
      return { ok: true, events: cal_().getEvents(from, to).map(evJson_) };
    }
    case 'upsert': return upsert_(o);
    case 'delete': return del_(o);
    case 'batch': return { ok: true, results: (o.ops || []).slice(0, 100).map(x => { try { return x.action === 'delete' ? del_(x) : upsert_(x); } catch (err) { return { ok: false, appId: x.appId, error: String(err) }; } }) };
    case 'dpull': return dpull_(o);
    case 'dpush': return dpush_(o);
    case 'dget': return dget_(o);
    case 'dinfo': return dinfo_();
    case 'gcsnow': return gcsNow_();
    case 'gold': return gold_();
    case 'stocks': return stocks_(o);
  }
  return { ok: false, error: 'action' };
}

function doPost(ev) {
  try { return out_(handle_(JSON.parse(ev.postData.contents))); }
  catch (err) { return out_({ ok: false, error: String(err) }); }
}
function doGet(ev) {   // 주소를 브라우저로 열었을 때 연결 확인용
  const p = ev && ev.parameter || {};
  if (p.key) { try { return out_(handle_({ key: p.key, action: p.action || 'ping', from: p.from, to: p.to })); } catch (err) { return out_({ ok: false, error: String(err) }); } }
  return out_({ ok: true, hello: '放下着 JIKIMi 캘린더 연결 프로그램이 켜져 있어요' });
}

/* ═════════ 🔄 기록 자동 맞춤 (2026-10-01): 노트북·휴대폰·태블릿의 지킴이 기록을 이 구글 드라이브 폴더에 모아 서로 맞춤 ═════════
 * 묶음(key): 'm:2026-10'(그 달 기록) · 't:여행id' · 's'(설정·메모장) · 'p:사진id'
 *   {key, action:'dpull', since}            → {ok, now, docs:[{key, rev, del, data}]}   (since 뒤에 바뀐 묶음만)
 *   {key, action:'dpush', ops:[{key, base, data|null}]} → {ok, now, results:[{key, ok, rev} | {key, conflict, rev, del, data}]}
 *   base(내가 마지막으로 본 판 번호)가 지금 판과 다르면 덮어쓰지 않고 지금 것을 돌려줌 → 앱이 항목마다 합쳐서 다시 보냄
 */
const DATA_DIR = '放下着 JIKIMi 기록 (자동 맞춤)';
function dir_() { const it = DriveApp.getFoldersByName(DATA_DIR); return it.hasNext() ? it.next() : DriveApp.createFolder(DATA_DIR); }
function file_(d, name) { const it = d.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function readJ_(d, name, def) { const f = file_(d, name); if (!f) return def; try { return JSON.parse(f.getBlob().getDataAsString('UTF-8')); } catch (err) { return def; } }
function writeJ_(d, name, o) { const s = JSON.stringify(o), f = file_(d, name); if (f) f.setContent(s); else d.createFile(name, s, 'application/json'); }
/* 2026-10-04 모든 것 맞춤: 'l:키'(작은 저장 값 → data.json) · 'x:키'(큰 자료 → 파일 하나씩) 더함 */
function pname_(key) { const k = String(key); if (k[0] !== 'x') return 'p_' + k.slice(2).replace(/[^\w-]/g, '_') + '.json'; /* 사진은 예전 이름 그대로 */ return 'x_' + Utilities.base64EncodeWebSafe(Utilities.newBlob(k).getBytes()).replace(/=+$/, '') + '.json'; }
const isP_ = k => /^(p:|x:)/.test(String(k));
/* 📸 2026-10-22 찍은 책 쪽 그림(x:bkp:…, 수백~수천 장): dpull엔 이름·판 번호만(big) → 앱이 dget으로 조금씩 받음 (한꺼번에 받다 맞춤이 막히지 않게) */
const isBig_ = k => /^x:bkp:/.test(String(k));
function dget_(o) {
  const d = dir_(), idx = readJ_(d, 'index.json', { docs: {} }), docs = []; let size = 0;
  for (const k of (o.keys || []).slice(0, 80)) {
    const x = idx.docs[k]; if (!x || x.del) { docs.push({ key: k, rev: x ? x.rev : 0, del: true }); continue; }
    const data = readJ_(d, pname_(k), null), s = JSON.stringify(data || '').length;
    if (docs.length && size + s > 4000000) break; size += s; docs.push({ key: k, rev: x.rev, data: data });
  }
  return { ok: true, bigv: 1, docs: docs };
}

/* 📱 2026-11-03 휴대폰·태블릿(lite)은 큰 파일(녹음·사진·첨부·동영상)을 이름·판 번호만 받음 → 받기가 늘 가볍고 빠름 (폴드가 19MB·4분짜리 받기에 막혀 하루 종일 맞춤이 안 됐던 일)
   필요한 큰 파일은 누를 때 dget으로 하나씩. 지키미·비밀 수첩 상자·자료실 작은 그림·내 노래·찍은 책 목록은 그대로 받음 */
const liteFull_ = k => /^x:(sec:(jk|v)$|jr[sp]:|jkMusic:|bk:bk)/.test(String(k));
function dpull_(o) {
  const now = Date.now(), d = dir_(), idx = readJ_(d, 'index.json', { docs: {} }), since = Number(o.since) || 0;
  const keys = Object.keys(idx.docs).filter(k => (idx.docs[k].at || 0) > since);
  let data = null; const docs = [];
  for (const k of keys) {
    const x = idx.docs[k], doc = { key: k, rev: x.rev, del: !!x.del, data: null };
    if (!x.del) {
      if (isBig_(k) || (o.lite && /^x:/.test(k) && !liteFull_(k))) doc.big = 1;
      else if (isP_(k)) doc.data = readJ_(d, pname_(k), null);
      else { if (!data) data = readJ_(d, 'data.json', {}); doc.data = data[k] === undefined ? null : data[k]; }
    }
    docs.push(doc);
  }
  return { ok: true, now: now, docs: docs };
}

function dpush_(o) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const d = dir_(), idx = readJ_(d, 'index.json', { docs: {} }); let data = null, dataDirty = false;
    const loadData = () => { if (!data) data = readJ_(d, 'data.json', {}); return data; };
    const results = [];
    for (const op of (o.ops || [])) {
      const k = String(op.key || ''); if (!/^(m:|t:|p:|s$|l:|x:)/.test(k)) { results.push({ key: k, ok: false, error: 'key' }); continue; }
      const cur = idx.docs[k], curRev = cur ? cur.rev : 0;
      if ((Number(op.base) || 0) !== curRev) {   // 다른 기기가 먼저 바꿈 → 지금 것을 돌려줌
        const back = { key: k, conflict: true, rev: curRev, del: !!(cur && cur.del), data: null };
        if (cur && !cur.del) back.data = isP_(k) ? readJ_(d, pname_(k), null) : (loadData()[k] === undefined ? null : data[k]);
        results.push(back); continue;
      }
      const rev = curRev + 1, at = Date.now();
      if (op.data == null) {
        if (isP_(k)) { const f = file_(d, pname_(k)); if (f) f.setTrashed(true); } else if (loadData()[k] !== undefined) { delete data[k]; dataDirty = true; }
        idx.docs[k] = { rev: rev, at: at, del: true };
      } else {
        if (isP_(k)) writeJ_(d, pname_(k), op.data); else { loadData()[k] = op.data; dataDirty = true; }
        idx.docs[k] = { rev: rev, at: at };
      }
      results.push({ key: k, ok: true, rev: rev });
    }
    if (dataDirty) writeJ_(d, 'data.json', data);
    writeJ_(d, 'index.json', idx);
    return { ok: true, now: Date.now(), results: results };
  } finally { lock.releaseLock(); }
}

function dinfo_() { const idx = readJ_(dir_(), 'index.json', { docs: {} }); const ks = Object.keys(idx.docs).filter(k => !idx.docs[k].del); const P = PropertiesService.getScriptProperties();
  return { ok: true, docs: ks.length, months: ks.filter(k => k[0] === 'm').length, gcs: { on: P.getProperty('gcsOn') === '1', last: Number(P.getProperty('gcsLast') || 0), msg: P.getProperty('gcsMsg') || '' } }; }

/** 처음 한 번(코드를 새로 붙여 넣은 뒤에도 한 번): 이 함수를 골라 ▶실행 → 구글이 캘린더·드라이브 권한을 물으면 허락 */
function 권한_허락하기() { Logger.log('연결된 캘린더: ' + cal_().getName() + ' · 기록 폴더: ' + dir_().getName()); }

/* ═════════ 📅 구글이 직접 캘린더 맞춤 (2026-10-10 지킴이님: “노트북이 꺼져 있어도 폴드·휴대폰 일정과 지킴이가 늘 맞춰지게”) ═════════
 * 5분마다(시간 트리거) 구글이 스스로 — 노트북 지킴이가 하던 일과 같은 규칙으로:
 *  ① 지킴이 일정(드라이브 data.json의 m:달) → 구글 캘린더 (새로 넣기·고치기·앱에서 지운 것 지우기)
 *  ② 휴대폰 캘린더에 적은·고친 일정 → 지킴이 기록 (모든 기기가 자동 맞춤으로 받음)
 *  ③ 공모주 청약·환불·상장(설정 s의 ipo) → 캘린더
 * 안전: 휴대폰에서 지운 일정 때문에 지킴이 기록을 지우지 않음 · 한 번에 5개 넘게 지워야 하면 지우지 않고 기다림
 * 짝 정보는 드라이브 gcs-map.json. 켜져 있으면 노트북 지킴이는 캘린더 일을 쉼(dinfo의 gcs).
 * 처음 한 번: 자동맞춤_켜기 ▶실행 → 권한 허락.  끄기: 자동맞춤_끄기 */
/* 📅 2026-11-27 지킴이님(“공부·배움·명언 같은 분류는 그 분류에만 — 캘린더에 들어가면 안 돼. 오늘의 일정 분류로 넣거나 일정 쓰기로 기록한 것만 캘린더로”):
   캘린더로 보내는 것 = 일정 분류(할 일·일정·행사·약속·알람·반복·기념일·병원·납부·공모주, 내가 만든 ‘여행·약속·모임’ 같은 분류) + 분류 없이 할 일·시간을 정한 일정 + 휴대폰에서 온 일정.
   공부·일기·명언(좋은 말)·주식 글·수입지출·기록 같은 글은 안 보냄 → 이미 들어간 것은 캘린더에서만 지움(지킴이 기록은 그대로) */
const GCS = { back: 60, ahead: 400, skip: { gift: 1, stock: 1 }, cal: { todo: 1, event: 1, meet: 1, alarm: 1, repeat: 1, anniv: 1, health: 1, bill: 1, ipo: 1 }, calName: /여행|약속|일정|모임|행사|병원|예약/, calGrp: /^(할 일|휴대폰 일정|휴대폰 되풀이 일정|일정·행사|약속|알람)$/, tail: '(放下着 JIKIMi)', maxDel: 5, catDel: 25, budget: 270000 };
function gcsCalOk_(e, cats) { if (!e) return false; const cq = e.cq || '';
  if (GCS.cal[cq]) return true;
  const c = cq && cq !== 'etc' ? (cats || []).filter(x => x && x.k === cq)[0] : null;
  if (c && GCS.calName.test(String(c.name || ''))) return true;
  const writing = { study: 1, diary: 1, stock: 1, money: 1, gift: 1 }[cq] || (c && /말|명언|글|이체|수익|내역|변동|공부|배움|일기/.test(String(c.name || '')));
  if (!writing && String(e.date || '') >= ymd_(new Date())) return true; // 앞으로 있을 일(예: ‘한 일’로 적은 병원 검사)은 남김
  if (c) return false;
  return GCS.calGrp.test(String(e.grp || '')) || (!cq && /^\d{1,2}:\d{2}$/.test(e.time || '')); }
function gcsSkipCq_(e, cats) { return !gcsCalOk_(e, cats); }
function 자동맞춤_켜기() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'gcsRun').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('gcsRun').timeBased().everyMinutes(5).create();
  const P = PropertiesService.getScriptProperties(); P.setProperty('gcsOn', '1'); P.deleteProperty('gcsSig');
  const r = gcsSync_({ force: true }); Logger.log('✅ 켜졌어요 — 5분마다 구글이 직접 맞춰요. 처음 맞춤: ' + JSON.stringify(r));
}
function 자동맞춤_끄기() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'gcsRun').forEach(t => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().setProperty('gcsOn', '0'); Logger.log('껐어요 — 다시 노트북 지킴이가 캘린더를 맞춰요');
}
/* 2026-10-15: 편집기에서 이 함수를 골라 ▶ 실행 → '외부 서비스 연결' 허락 창 → 허용. 그래야 웹 앱이 주가·금값을 받아 옴 */
function 시세_허락받기() {
  const r = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/005930.KS', { muteHttpExceptions: true });
  CacheService.getScriptCache().removeAll(['gold']);
  Logger.log('허락 됐어요 — 인터넷 응답 ' + r.getResponseCode() + ' / 금값: ' + JSON.stringify(gold_()).slice(0, 120));
}
function gcsRun() { if (PropertiesService.getScriptProperties().getProperty('gcsOn') !== '1') return; gcsSync_({}); }
/* 지킴이를 열었을 때·일정을 적었을 때 앱이 부름 → 5분을 기다리지 않고 바로 한 번 (20초 안에 또 부르면 건너뜀) */
function gcsNow_() {
  const P = PropertiesService.getScriptProperties(); if (P.getProperty('gcsOn') !== '1') return { ok: true, off: true };
  if (Date.now() - Number(P.getProperty('gcsLast') || 0) < 20000) return { ok: true, recent: true };
  return gcsSync_({ force: !gcsHasAdv_() });
}
function gcsHasAdv_() { try { return typeof Calendar !== 'undefined' && !!Calendar.Events; } catch (e) { return false; } }
function gcsH_(s) { let h1 = 0x811c9dc5, h2 = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0; } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36); } // 지킴이 앱 gsH와 똑같음(같은 id)
function gcsAddDays_(d, n) { const x = parseDay_(d); x.setDate(x.getDate() + n); return ymd_(x); }

/* ── 순수 계산(시험하기 쉽게): 지킴이 기록·공모주·캘린더 일정·짝 정보 → 할 일 목록 ── */
function gcsPlan_(ctx) {
  const now = ctx.now, from = ctx.from, to = ctx.to, M = ctx.map.items || (ctx.map.items = {}), IGN = ctx.map.ign || (ctx.map.ign = {});
  const out = { recAdds: [], recUpd: [], evCreate: [], evUpdate: [], evDelete: [], evTag: [], log: [] };
  const GONE = {}; (ctx.gone || []).forEach(x => { if (x && x.id != null) GONE[String(x.id)] = 1; }); // 지킴이에서 지운 기록 (설정 gone, 기기끼리 맞춤)
  const isIpo = id => String(id || '').indexOf('ipo:') === 0;
  const want = e => !!(e && e.kind === 'plan' && e.date && !GCS.skip[e.cq] && gcsCalOk_(e, ctx.cats) && !e.grec);
  const pay = e => Object.assign({ title: String(e.label || e.memo || '일정').slice(0, 300), date: e.date, time: /^\d{1,2}:\d{2}$/.test(e.time || '') ? e.time : '', desc: (isIpo(e.id) && e.memo ? '📈 ' + e.memo + '\n' : '') + (e.more ? e.more + '\n' : '') + (e.note ? e.note + '\n' : '') + GCS.tail }, isIpo(e.id) ? { rem: e.cancel ? 'none' : 0 } : {}); // 철회된 공모주는 알림 없음
  const payH = e => gcsH_(JSON.stringify(pay(e)));
  const evEq = (v, p) => v.title === p.title && v.date === p.date && (v.allDay ? '' : (v.time || '')) === p.time && String(v.desc || '') === p.desc;
  const nrm = s => String(s || '').replace(/[\s.,;:!?·~()\[\]<>\-_'"“”‘’]/g, '');
  const same = (a, b) => { a = nrm(a); b = nrm(b); if (!a || !b) return false; if (a === b || (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0))) return true; const s = a.length < b.length ? a : b, l = a.length < b.length ? b : a; for (let i = 0; i + 4 <= s.length; i++) if (l.indexOf(s.slice(i, i + 4)) >= 0) return true; return false; };
  const note = d => String(d || '').replace(/\n?\(放下着 JIKIMi\)\s*$/, '').replace(/\n?📈 [^\n]*\n?/, '').replace(/\n?放下着 JIKIMi에서 넣은 일정\s*$/, '').trim();
  const all = {}, items = {}, byG = {}, byK = {};
  (ctx.recs || []).forEach(e => { if (e && e.id) { all[e.id] = e; if (want(e)) items[e.id] = e; if (e.gk) byK[e.gk] = e.id; } });
  gcsIpoItems_(ctx.ipo || []).forEach(e => { items[e.id] = e; all[e.id] = e; });
  Object.keys(M).forEach(id => { if (M[id].g) byG[M[id].g] = id; });
  const seen = {};
  const setRec = (ne, old) => { const o = all[ne.id]; if (o && o.memo === ne.memo && o.label === ne.label && o.date === ne.date && (o.time || '') === (ne.time || '') && (o.note || '') === (ne.note || '')) return false; out.recUpd.push({ rec: ne, old: old }); all[ne.id] = ne; if (want(ne)) items[ne.id] = ne; return true; };
  // ① 캘린더 → 지킴이
  (ctx.events || []).forEach(v => {
    if (v.recurring) { // 되풀이 일정: 하나하나를 기록으로(앱과 같은 id), 앱에서 고쳐도 구글엔 안 보냄
      const k = v.gid + '|' + v.date; seen[k] = 1; const id = byG[k] || byK[k];
      if (!id && ctx.grecOff) return; // 2026-10-22 지킴이님(“반복 기록은 다 빼 줘”): 설정 grecOff면 휴대폰 되풀이 일정을 기록으로 새로 가져오지 않음
      if (id) { if (!M[id]) M[id] = { g: k, u: v.updated || 0, r: 1 }; byG[k] = id; return; }
      if (IGN[k]) return; const nid = 'g' + gcsH_(k);
      if (GONE[nid]) { IGN[k] = 1; return; } // 2026-10-20: 지킴이에서 지운 되풀이 일정을 다시 가져오지 않음 (예전엔 3분 뒤 ‘기타’로 되살아났음)
      if (all[nid]) { M[nid] = { g: k, u: v.updated || 0, r: 1 }; byG[k] = nid; return; }
      const ne = { id: nid, kind: 'plan', amount: 0, cat: '일정·기록', grp: '휴대폰 되풀이 일정', cq: 'etc', item: '', memo: String(v.title || '(제목 없음)'), date: v.date, time: v.allDay ? '' : (v.time || ''), people: [], created: now, mt: now, from: 'google', grec: 1, gk: k };
      const nt = note(v.desc); if (nt) ne.note = nt; out.recAdds.push(ne); all[nid] = ne; M[nid] = { g: k, u: v.updated || 0, r: 1 }; byG[k] = nid; return;
    }
    const k = v.gid; seen[k] = 1; let id = byG[k];
    if (!id && v.appId && all[v.appId] && !M[v.appId]) { // 노트북이 이름표를 붙여 둔 일정 → 짝 맞춤. 내용이 다르면 나중에 고친 쪽이 이김
      id = v.appId; const e = items[id]; M[id] = { g: k, u: v.updated || 0, h: '' }; byG[k] = id;
      if (e && evEq(v, pay(e))) M[id].h = payH(e);
      else if (e && !isIpo(id) && (v.updated || 0) > (e.mt || e.created || 0)) { const ne = JSON.parse(JSON.stringify(e)); ne.date = v.date || e.date; ne.time = v.allDay ? '' : (v.time || ''); ne.mt = now; if (e.label) ne.label = v.title; else ne.memo = v.title; const nt = note(v.desc); if (nt) ne.note = nt; else delete ne.note; setRec(ne, e.date); M[id].h = payH(ne); }
      return; }
    if (!id && IGN[k]) return;
    if (!id && v.appId && !isIpo(v.appId) && !all[v.appId]) { IGN[k] = 1; out.log.push('지킴이에서 지운 일정이 캘린더에 남아 있어요(가져오지 않음): ' + v.date + ' ' + v.title); return; } // 지운 기록을 되살리지 않음
    if (id) {
      const x = M[id], e = items[id]; if (!x) return;
      if (isIpo(id) || !e) { x.u = v.updated || x.u; return; }
      if ((v.updated || 0) > (x.u || 0)) {
        if (payH(e) === x.h && !evEq(v, pay(e))) { // 휴대폰에서 고침 → 지킴이 기록도
          const ne = JSON.parse(JSON.stringify(e)); ne.date = v.date || e.date; ne.time = v.allDay ? '' : (v.time || ''); ne.mt = now; if (e.label) ne.label = v.title; else ne.memo = v.title; const nt = note(v.desc); if (nt) ne.note = nt; else delete ne.note;
          if (setRec(ne, e.date)) out.log.push('휴대폰에서 고침: ' + ne.date + ' ' + v.title); x.h = payH(ne);
        }
        x.u = v.updated || 0;
      }
      return;
    }
    if (isIpo(v.appId)) return; // 예전 공모주 일정
    if (v.appId && all[v.appId]) { M[v.appId] = { g: k, u: v.updated || 0, h: '' }; byG[k] = v.appId; return; }
    if (IGN[k]) return;
    const nid = 'g' + gcsH_(k);
    if (GONE[nid]) { IGN[k] = 1; return; } // 2026-10-20: 지킴이에서 지운 휴대폰 일정은 다시 가져오지 않음
    if (all[nid]) { M[nid] = { g: k, u: v.updated || 0, h: '' }; byG[k] = nid; return; }
    const twin = Object.keys(items).map(i => items[i]).filter(e => !isIpo(e.id) && !M[e.id] && e.date === v.date && same(e.label || e.memo, v.title))[0];
    if (twin) { let e = twin; if (!e.time && v.time && !v.allDay) { e = JSON.parse(JSON.stringify(e)); e.time = v.time; e.mt = now; setRec(e, e.date); } M[e.id] = { g: k, u: v.updated || 0, h: '' }; byG[k] = e.id; return; }
    if (Object.keys(items).some(i => !isIpo(i) && items[i].date === v.date && same(items[i].label || items[i].memo, v.title))) { IGN[k] = 1; return; } // 같은 일정이 구글에 두 번 → 하나만
    const ne = { id: nid, kind: 'plan', amount: 0, cat: '일정·기록', grp: '휴대폰 일정', cq: 'etc', item: '', memo: String(v.title || '(제목 없음)'), date: v.date, time: v.allDay ? '' : (v.time || ''), people: [], created: now, mt: now, from: 'google' };
    const nt = note(v.desc); if (nt) ne.note = nt;
    out.recAdds.push(ne); all[nid] = ne; items[nid] = ne; M[nid] = { g: k, u: v.updated || 0, h: payH(ne) }; byG[k] = nid; out.evTag.push({ gid: k, appId: nid }); out.log.push('휴대폰 일정 가져옴: ' + ne.date + ' ' + ne.memo);
  });
  // 휴대폰에서 지운 일정: 지킴이 기록은 그대로 두고 짝만 ‘잃음’ (다시 올리지 않음)
  const lostC = Object.keys(M).filter(id => { const x = M[id], e = items[id]; return x.g && !x.r && !x.lost && !seen[x.g] && e && e.date >= from && e.date <= to; });
  const mapped = Object.keys(M).filter(id => M[id].g).length;
  if (lostC.length > 10 && lostC.length > mapped * 0.3) out.log.push('⚠ 캘린더에서 일정 ' + lostC.length + '개가 한꺼번에 안 보여서 아무것도 바꾸지 않았어요(다른 계정 연결?)');
  else lostC.forEach(id => { M[id].lost = 1; M[id].h = payH(items[id]); });
  // ② 지킴이 → 캘린더
  Object.keys(items).forEach(id => {
    const e = items[id]; if (e.grec) return; const x = M[id], h = payH(e);
    if (x && x.r) return;
    if (x && x.lost) { if (x.h === h) return; delete x.lost; delete x.g; }
    if (x && x.g && x.h === h) return;
    if (!(x && x.g) && (e.date < from || e.date > to)) return; // 오래전·아주 먼 일정은 새로 안 넣음
    if (x && x.g) out.evUpdate.push({ gid: x.g, appId: id, pay: pay(e), h: h }); else out.evCreate.push({ appId: id, pay: pay(e), h: h });
  });
  // 지킴이에서 지운 일정 → 캘린더에서도 (한꺼번에 많으면 기다림)
  const dels = [];
  Object.keys(M).forEach(id => { const x = M[id], e = all[id]; if (out.evDelete.length >= GCS.catDel) return; if (e && !isIpo(id) && x.g && !x.r && !x.ign && e.kind === 'plan' && !GCS.skip[e.cq] && gcsSkipCq_(e, ctx.cats)) out.evDelete.push({ gid: x.g, appId: id, cat: 1 }); }); // 한 번에 25개씩(구글 속도 제한) // 캘린더에 안 보내는 분류가 된 기록 → 캘린더에서만 지움 (지킴이 기록은 그대로)
  Object.keys(M).forEach(id => { const x = M[id]; if (all[id]) return; if (isIpo(id) || x.r || !x.g || x.lost) { delete M[id]; return; } dels.push({ gid: x.g, appId: id }); });
  if (dels.length > GCS.maxDel) out.log.push('⚠ 지킴이에서 없어진 일정이 ' + dels.length + '개라 캘린더에서는 지우지 않고 기다려요');
  else out.evDelete = out.evDelete.concat(dels);
  return out;
}
function gcsIpoItems_(list) { // 지킴이 앱 ipoItems와 같은 글자
  const md = d => d ? (+d.slice(5, 7)) + '.' + (+d.slice(8, 10)) : '', price = x => x.price ? '공모가 ' + x.price : (x.hope ? '희망 공모가 ' + x.hope : ''), brk = x => x.brokers || x.broker || '', brk1 = x => String(brk(x)).split(',')[0].trim(), TC = { s: '청약', r: '환불', l: '상장' };
  const out = [], AT = { s: '15:05', r: '14:10', l: '08:51' }; // 2026-10-15 지킴이님: 청약 오후 3시 5분 · 환불 오후 2시 10분 · 상장 오전 8시 51분에 알림
  list.forEach(x => { if (!x || !x.key) return; const can = x.cancel ? '❌ 철회 · ' : '', more = '🔎 자세히: https://m.search.naver.com/search.naver?query=' + encodeURIComponent(x.name + ' 공모주'), b = t => ({ kind: 'plan', amount: 0, cat: '일정·기록', grp: '공모주', cq: 'ipo', people: [], time: AT[t], more: more, cancel: !!x.cancel, ipoT: t, label: (x.cancel ? '❌' : '') + x.name + ' ' + TC[t] + ' · ' + brk1(x) });
    if (x.s2) out.push(Object.assign(b('s'), { id: 'ipo:' + x.key + ':s', date: x.s2, memo: can + x.name + ' 청약 (' + md(x.s1) + '~' + md(x.s2) + ') · ' + price(x) + ' · 증권사 ' + brk(x) }));
    if (x.refund) out.push(Object.assign(b('r'), { id: 'ipo:' + x.key + ':r', date: x.refund, memo: can + x.name + ' 환불일 · 증권사 ' + brk(x) }));
    if (x.listd) out.push(Object.assign(b('l'), { id: 'ipo:' + x.key + ':l', date: x.listd, memo: can + x.name + ' 상장' + (x.market ? ' (' + x.market + ')' : '') + ' · ' + price(x) + ' · 증권사 ' + brk(x) }));
  });
  return out;
}

/* ── 실제로 하기: 드라이브·캘린더 읽고 → 계산 → 캘린더 고치기 → 기록 쓰기 ── */
function gcsSync_(opt) {
  opt = opt || {}; const t0 = Date.now(), P = PropertiesService.getScriptProperties(), lk = LockService.getUserLock();
  if (!lk.tryLock(2000)) return { ok: true, busy: true };
  try {
    const d = dir_(), idx = readJ_(d, 'index.json', { docs: {} }), today = ymd_(new Date()), from = gcsAddDays_(today, -GCS.back), to = gcsAddDays_(today, GCS.ahead);
    // 바뀐 게 없으면 쉬기: 지킴이 기록 판 번호 · 캘린더 바뀐 시각 · 30분마다는 꼭 한 번
    const sig = gcsH_(Object.keys(idx.docs).filter(k => k[0] === 'm' || k === 's').sort().map(k => k + ':' + idx.docs[k].rev).join(','));
    const last = Number(P.getProperty('gcsLast') || 0), lastFull = Number(P.getProperty('gcsFull') || 0);
    let calCh = true;
    if (!opt.force && gcsHasAdv_()) { try { const r = Calendar.Events.list('primary', { updatedMin: new Date(last - 120000).toISOString(), showDeleted: true, maxResults: 5, fields: 'items(id)' }); calCh = !!(r.items && r.items.length); } catch (e) { calCh = true; } }
    else if (!opt.force) calCh = Date.now() - lastFull > 9 * 60000; // 고급 서비스가 없으면 10분마다 캘린더 훑기
    if (!opt.force && sig === P.getProperty('gcsSig') && !calCh && Date.now() - lastFull < 30 * 60000) { P.setProperty('gcsLast', String(Date.now())); return { ok: true, idle: true }; }
    const data = readJ_(d, 'data.json', {}), recs = [];
    Object.keys(data).forEach(k => { if (k[0] === 'm' && k[1] === ':' && Array.isArray(data[k])) data[k].forEach(e => { if (e && e.id) recs.push(e); }); });
    const s = data['s'] || {}, ipo = (s.ipo && s.ipo.list) || [];
    const c = cal_(), evs = c.getEvents(parseDay_(from), parseDay_(gcsAddDays_(to, 1))).map(evJson_);
    const map = readJ_(d, 'gcs-map.json', { items: {}, ign: {} });
    const plan = gcsPlan_({ now: Date.now(), from: from, to: to, recs: recs, ipo: ipo, cats: Array.isArray(s.calCats) ? s.calCats : [], gone: Array.isArray(s.gone) ? s.gone : [], grecOff: !!s.grecOff, events: evs, map: map });
    // 캘린더 고치기 (시간이 모자라면 다음 차례에 이어서)
    let nC = 0, nU = 0, nD = 0, nT = 0;
    const tight = () => Date.now() - t0 > GCS.budget;
    plan.evCreate.concat(plan.evUpdate).forEach(op => { if (tight()) return; try { const r = upsert_(Object.assign({ appId: op.appId, gid: op.gid || '' }, op.pay)); map.items[op.appId] = { g: r.gid, u: r.updated, h: op.h }; if (op.gid) nU++; else nC++; } catch (e) { plan.log.push('보내기 실패 ' + op.appId + ': ' + e); } });
    plan.evDelete.forEach(op => { if (tight()) return; const r = del_({ gid: op.gid }); if (r.ok || !op.cat || /not found|찾을 수 없|없습니다/i.test(String(r.error || ''))) delete map.items[op.appId]; if (r.ok) nD++; });
    // 지킴이 기록 쓰기 (다른 기기가 그 사이 보낸 것과 겹치지 않게, 잠그고 새로 읽어서 고친 것만)
    let nR = 0;
    if (plan.recAdds.length || plan.recUpd.length) {
      const sl = LockService.getScriptLock(); sl.waitLock(30000);
      try {
        const idx2 = readJ_(d, 'index.json', { docs: {} }), data2 = readJ_(d, 'data.json', {}), touched = {};
        const mk = r => 'm:' + String(r.date).slice(0, 7);
        plan.recAdds.forEach(r => { const k = mk(r), a = data2[k] || []; if (a.some(x => x && x.id === r.id)) return; a.push(r); data2[k] = a; touched[k] = 1; nR++; });
        plan.recUpd.forEach(u => { const ok = u.old ? 'm:' + String(u.old).slice(0, 7) : mk(u.rec), a0 = data2[ok] || []; if (!a0.some(x => x && x.id === u.rec.id)) return; // 그 사이 지워졌으면 그대로 둠
          data2[ok] = a0.filter(x => x && x.id !== u.rec.id); touched[ok] = 1; const k = mk(u.rec), a = data2[k] || []; a.push(u.rec); data2[k] = a; touched[k] = 1; nR++; });
        const at = Date.now();
        Object.keys(touched).forEach(k => { const cur = idx2.docs[k], rev = (cur ? cur.rev : 0) + 1; if (data2[k] && data2[k].length) idx2.docs[k] = { rev: rev, at: at }; else { delete data2[k]; idx2.docs[k] = { rev: rev, at: at, del: true }; } });
        writeJ_(d, 'data.json', data2); writeJ_(d, 'index.json', idx2);
      } finally { sl.releaseLock(); }
    }
    // 기록을 쓴 뒤에야 휴대폰 일정에 이름표를 붙임 (쓰다 실패하면 다음 차례에 다시 가져오게)
    plan.evTag.forEach(op => { try { const e = c.getEventById(op.gid); if (e) { e.setTag(TAG, op.appId); nT++; } } catch (e) {} });
    writeJ_(d, 'gcs-map.json', map);
    const idx3 = nR ? readJ_(d, 'index.json', { docs: {} }) : idx;
    P.setProperty('gcsSig', gcsH_(Object.keys(idx3.docs).filter(k => k[0] === 'm' || k === 's').sort().map(k => k + ':' + idx3.docs[k].rev).join(',')));
    P.setProperty('gcsLast', String(Date.now())); P.setProperty('gcsFull', String(Date.now()));
    const msg = '캘린더에 새로 ' + nC + ' · 고침 ' + nU + ' · 지움 ' + nD + ' / 지킴이에 ' + nR + (plan.log.length ? ' · ' + plan.log.slice(0, 3).join(' · ') : '');
    P.setProperty('gcsMsg', msg.slice(0, 400));
    return { ok: true, created: nC, updated: nU, deleted: nD, tagged: nT, records: nR, log: plan.log.slice(0, 20), ms: Date.now() - t0 };
  } finally { lk.releaseLock(); }
}


// 🥇 내가 사고팔 때 금값 (2026-10-07): 한국금거래소 순금 1돈 살 때·팔 때 + 한 달 변화 — 휴대폰·태블릿 앱이 여기서 받음 (5분 저장)
/* ⭐ 관심 종목 새 시세 (2026-10-14 지킴이님): 휴대폰은 노트북이 꺼져 있으면 시세를 못 받음 → ↻ 누를 때 한 번만 여기서 네이버 증권 주가·등락률을 받아 줌
 * {key, action:'stocks', q:['삼성전자','005930',…]} → {ok, stk:{at, lite:true, items:[{q,c,n,p,ch,r,s,t} | {q,err}]}} (1분 동안은 같은 답) */
function stocks_(o) {
  const qs = (Array.isArray(o.q) ? o.q : []).slice(0, 15).map(String), cache = CacheService.getScriptCache(), ck = 'stk:' + qs.join('|').slice(0, 200), hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  /* 2026-10-14: 네이버 모바일 주소는 구글 서버(외국)에서 막힘 → 받을 수 있는 곳을 차례로: 네이버 모바일 → 네이버 실시간 → 네이버 요약 → 야후 파이낸스(.KS/.KQ). src = 받은 곳, why = 못 받은 까닭 */
  const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
  const G = (u, ref) => { try { const h = { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' }; if (ref) h.Referer = ref; const r = UrlFetchApp.fetch(u, { headers: h, muteHttpExceptions: true }); let j = null; try { j = JSON.parse(r.getContentText()); } catch (e) {} return { c: r.getResponseCode(), j: j }; } catch (err) { return { c: 'x', j: null }; } };
  const num = x => Math.round(Number(x) || 0).toLocaleString('en-US'), sg = x => (Number(x) > 0 ? '' : Number(x) < 0 ? '-' : '') + num(Math.abs(Number(x) || 0));
  const quote = (code, why) => {
    let a = G('https://m.stock.naver.com/api/stock/' + code + '/basic', 'https://m.stock.naver.com/'); why.push('m' + a.c);
    if (a.j && a.j.closePrice) return { n: String(a.j.stockName || ''), p: String(a.j.closePrice), ch: String(a.j.compareToPreviousClosePrice || ''), r: String(a.j.fluctuationsRatio || ''), s: String(a.j.marketStatus || ''), t: String(a.j.localTradedAt || ''), src: 'naver' };
    a = G('https://polling.finance.naver.com/api/realtime/domestic/stock/' + code, 'https://finance.naver.com/'); why.push('p' + a.c);
    const d = a.j && a.j.datas && a.j.datas[0];
    if (d && d.closePrice) return { n: String(d.stockName || ''), p: String(d.closePrice), ch: String(d.compareToPreviousClosePrice || ''), r: String(d.fluctuationsRatio || ''), s: String(d.marketStatus || ''), t: String(d.localTradedAt || ''), src: 'polling' };
    a = G('https://api.finance.naver.com/service/itemSummary.nhn?itemcode=' + code, 'https://finance.naver.com/'); why.push('s' + a.c);
    if (a.j && a.j.now) return { n: '', p: num(a.j.now), ch: sg(a.j.diff), r: String(a.j.rate != null ? a.j.rate : ''), s: '', t: '', src: 'summary' };
    for (const sx of ['.KS', '.KQ']) {
      a = G('https://query1.finance.yahoo.com/v8/finance/chart/' + code + sx + '?range=5d&interval=1d', ''); why.push('y' + sx + a.c);
      const m = a.j && a.j.chart && a.j.chart.result && a.j.chart.result[0] && a.j.chart.result[0].meta;
      if (m && m.regularMarketPrice) { const p = Number(m.regularMarketPrice), pc = Number(m.previousClose || m.chartPreviousClose || 0), ch = pc ? p - pc : 0;
        return { n: '', p: num(p), ch: sg(ch), r: pc ? (ch / pc * 100).toFixed(2) : '', s: '', t: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : '', src: 'yahoo' }; }
    }
    return null;
  };
  const items = qs.map(q => {
    let code = /^[0-9][0-9A-Z]{5}$/.test(q) ? q : null;
    if (!code) { const ac = G('https://ac.stock.naver.com/ac?q=' + encodeURIComponent(q) + '&target=stock', 'https://m.stock.naver.com/'), h = ac.j && (ac.j.items || []).filter(x => x.nationCode === 'KOR')[0]; if (h) code = String(h.code); }
    if (!code) return { q: q, err: '종목을 못 찾았어요' };
    const why = [], x = quote(code, why);
    return x ? Object.assign({ q: q, c: code }, x) : { q: q, c: code, err: '시세를 못 받았어요', why: why.join(' ') };
  });
  const r = { ok: true, stk: { at: Date.now(), lite: true, items: items } };
  if (items.some(x => x.p)) cache.put(ck, JSON.stringify(r), 60);
  return r;
}

/* 야후 GC=F(달러/온스)×KRW=X → 1g → 1돈(3.75g). 금거래소와 맞춘 비율(2026-10-15): 살 때 1.177, 팔 때 1.012, 18K 0.735, 14K 0.570 */
function goldY_() {
  const ua = { 'User-Agent': 'Mozilla/5.0' }, Y = s => JSON.parse(UrlFetchApp.fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + s + '?range=1mo&interval=1d', { headers: ua, muteHttpExceptions: true }).getContentText()).chart.result[0];
  try {
    const g = Y('GC=F'), k = Y('KRW=X'), don = (u, w) => u * w / 31.1035 * 3.75;
    const B = d => Math.round(d * 1.177 / 1000) * 1000, S = d => Math.round(d * 1.012 / 1000) * 1000;
    const kc = k.indicators.quote[0].close, kt = k.timestamp, fx = t => { let v = k.meta.regularMarketPrice; for (let i = 0; i < kt.length; i++) if (kt[i] <= t + 864e2 && kc[i]) v = kc[i]; return v; };
    const now = don(g.meta.regularMarketPrice, k.meta.regularMarketPrice), prev = don(g.meta.chartPreviousClose || g.meta.previousClose || g.meta.regularMarketPrice, k.meta.chartPreviousClose || k.meta.regularMarketPrice);
    const gc = g.indicators.quote[0].close, h = [];
    g.timestamp.forEach((t, i) => { if (gc[i]) { const d = don(gc[i], fx(t)); h.unshift([Utilities.formatDate(new Date(t * 1000), TZ, 'yyyy-MM-dd'), B(d), S(d)]); } });
    const pd = h.length > 1 ? h[1] : [0, B(prev), S(prev)], buy = B(now), sell = S(now), pct = (a, b) => b ? Math.round((a - b) / b * 10000) / 100 : 0;
    return { ok: true, goldr: { buy: buy, sell: sell, bc: buy - pd[1], br: pct(buy, pd[1]), sc: sell - pd[2], sr: pct(sell, pd[2]),
      b18: Math.round(buy * 0.735), s18: Math.round(sell * 0.735), b14: Math.round(buy * 0.570), s14: Math.round(sell * 0.570),
      t: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' 국제 시세로 어림', h: h.slice(0, 40), at: Date.now(), src: 'yahoo' } };
  } catch (err) { return { ok: false, error: 'gold', why: String(err).slice(0, 120) }; }
}
function gold_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('gold');
  if (hit) return JSON.parse(hit);
  const ua = { 'User-Agent': 'Mozilla/5.0' };
  /* 2026-10-15: 한국금거래소는 구글 서버(외국)에 html을 돌려줌 → 그땐 goldY_(야후 국제 금값×환율로 어림) */
  let o = null;
  try { o = JSON.parse(UrlFetchApp.fetch('https://www.koreagoldx.co.kr/api/main', { headers: ua, muteHttpExceptions: true }).getContentText()).officialPrice4; } catch (err) {}
  if (!o || !o.s_pure) { const y = goldY_(); if (y.ok) cache.put('gold', JSON.stringify(y), 600); return y; }
  const f = d => Utilities.formatDate(d, TZ, 'yyyy.MM.dd'), now = new Date(), from = new Date(now.getTime() - 31 * 864e5);
  let h = [];
  try {
    const L = JSON.parse(UrlFetchApp.fetch('https://www.koreagoldx.co.kr/api/price/chart/list', { method: 'post', contentType: 'application/json; charset=utf-8', headers: ua, muteHttpExceptions: true,
      payload: JSON.stringify({ srchDt: '1M', type: 'Au', dataDateStart: f(from), dataDateEnd: f(now) }) }).getContentText()).list || [];
    h = L.slice(0, 40).map(x => [x.date, x.s_pure, x.p_pure]);
  } catch (err) {}
  const r = { ok: true, goldr: { buy: o.s_pure, sell: o.p_pure, bc: o.turm_s_pure, br: o.per_s_pure, sc: o.turm_p_pure, sr: o.per_p_pure, b18: o.s_18k, s18: o.p_18k, b14: o.s_14k, s14: o.p_14k, t: o.date, h: h, at: Date.now() } };
  cache.put('gold', JSON.stringify(r), 300);
  return r;
}