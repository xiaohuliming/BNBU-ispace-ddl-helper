// content-dashboard.js — Inject Autolab DDLs + done button + sync button
(function () {
  'use strict';

  const TAG = 'data-ddl-injected';

  function getDeadlines() { return new Promise(r => chrome.storage.local.get('deadlines', d => r(d.deadlines || []))); }
  function getDoneIds() { return new Promise(r => chrome.storage.local.get('doneIds', d => r(new Set(d.doneIds || [])))); }
  function getAutolabUrls() { return new Promise(r => chrome.storage.local.get('autolabUrls', d => r(d.autolabUrls || []))); }
  function esc(s) { const e = document.createElement('div'); e.textContent = s; return e.innerHTML; }

  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, resp => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!resp || !resp.ok) reject(new Error(resp?.error || 'Fetch failed'));
        else resolve(resp.html);
      });
    });
  }

  // ======== Autolab parsing ========
  function parseAutolabDate(str) {
    const m = str.trim().match(/(\w+)\s+(\d+)\s+at\s+(\d+):(\d+)(am|pm)/i);
    if (!m) return null;
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mi = months.indexOf(m[1].toLowerCase().substring(0, 3));
    if (mi < 0) return null;
    let h = parseInt(m[3]);
    if (m[5].toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[5].toLowerCase() === 'am' && h === 12) h = 0;
    // Smart year: default to current year, bump to next year if date is >2 months in the past
    let year = new Date().getFullYear();
    const candidate = new Date(year, mi, parseInt(m[2]), h, parseInt(m[4]));
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    if (candidate < twoMonthsAgo) year += 1;
    return new Date(year, mi, parseInt(m[2]), h, parseInt(m[4]));
  }
  function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function fmtTime(d) { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

  function parseAutolabPage(doc, pageUrl) {
    const dls = [];
    const course = doc.querySelector('.card-title b')?.textContent?.trim()
      || doc.querySelector('.card-title')?.textContent?.trim()
      || doc.querySelector('.sub-navigation .title')?.textContent?.trim()
      || doc.querySelector('h1, h2, .course-title')?.textContent?.trim() || '';
    // Extract course slug from URL as stable identifier
    const courseSlug = pageUrl.match(/\/courses\/([\w-]+)/)?.[1] || '';
    doc.querySelectorAll('a.collection-item').forEach(item => {
      const p = item.querySelector('p.date');
      if (!p) return;
      const dm = p.textContent.match(/Due:\s*(.+?)$/m);
      if (!dm) return;
      const parsed = parseAutolabDate(dm[1].trim());
      if (!parsed) return;
      let name = '';
      for (const n of item.childNodes) { if (n.nodeType === Node.TEXT_NODE) { const t = n.textContent.trim(); if (t) { name = t; break; } } }
      if (!name) name = item.textContent.split('\n')[0].trim() || 'Unknown';
      const href = item.getAttribute('href') || '';
      const base = pageUrl.match(/^https?:\/\/[^/]+/)?.[0] || 'http://172.31.12.111';
      dls.push({ id: `autolab-${courseSlug || 'dashboard'}-${name}`.replace(/\s+/g, '_'), date: fmtDate(parsed), time: fmtTime(parsed),
        assignment: name, courseName: course, courseId: 'dashboard', source: 'autolab',
        autolabUrl: href.startsWith('http') ? href : base + href, scannedAt: new Date().toISOString() });
    });
    return dls;
  }

  async function fetchAutolabDeadlines(autolabBaseUrl) {
    let url = autolabBaseUrl;
    if (!url.includes('/courses')) url += '/courses';
    url = url.replace(/\/+$/, '');
    const html = await bgFetch(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let all = parseAutolabPage(doc, url);
    if (all.length === 0) {
      const cUrls = new Set();
      doc.querySelectorAll('a[href*="/courses/"]').forEach(l => {
        const m = l.getAttribute('href')?.match(/^(\/courses\/[\w-]+)\/?$/);
        if (m) { const b = url.match(/^https?:\/\/[^/]+/)?.[0] || 'http://172.31.12.111'; cUrls.add(b + m[1]); }
      });
      for (const cu of cUrls) {
        try { const h = await bgFetch(cu); all.push(...parseAutolabPage(parser.parseFromString(h, 'text/html'), cu)); }
        catch (e) { console.warn('[DDL Helper]', cu, e.message); }
      }
    }
    return all;
  }

  async function syncAllAutolab() {
    const urls = await getAutolabUrls();
    if (!urls.length) return { count: 0, error: 'no_urls' };
    let all = [];
    for (const u of urls) {
      try { all.push(...await fetchAutolabDeadlines(u.url)); } catch (e) { console.warn('[DDL Helper]', u.url, e.message); }
    }
    if (all.length > 0) {
      await new Promise(resolve => {
        chrome.storage.local.get('deadlines', data => {
          const merged = [...(data.deadlines || [])];
          for (const nd of all) { const idx = merged.findIndex(e => e.id === nd.id); if (idx >= 0) merged[idx] = nd; else merged.push(nd); }
          merged.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
          chrome.storage.local.set({ deadlines: merged }, resolve);
        });
      });
    }
    return { count: all.length };
  }

  // ======== Mark done ========
  function markDone(id) {
    chrome.storage.local.get('doneIds', data => {
      const ids = new Set(data.doneIds || []);
      ids.add(id);
      chrome.storage.local.set({ doneIds: [...ids] });
    });
  }

  // ======== Timeline DOM ========
  function getDateGroups(wrapper) {
    const groups = [];
    const ch = [...wrapper.children];
    for (let i = 0; i < ch.length; i++) {
      if (ch[i].getAttribute('data-region') === 'event-list-content-date' && !ch[i].hasAttribute(TAG)) {
        const ts = ch[i].getAttribute('data-timestamp');
        const ds = ts ? timestampToDateStr(parseInt(ts)) : parseDateText(ch[i].textContent.trim());
        const list = ch[i + 1]?.classList?.contains('list-group') ? ch[i + 1] : null;
        groups.push({ dateStr: ds, headerEl: ch[i], listEl: list });
      }
    }
    return groups;
  }
  function timestampToDateStr(ts) { const d = new Date(ts * 1000); return fmtDate(d); }
  function dateStrToTimestamp(s) { return Math.floor(new Date(s + 'T00:00:00').getTime() / 1000); }
  function parseDateText(text) {
    const mo = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
    const m = text.match(/(\d+)\s+(\w+)\s+(\d{4})/);
    return m && mo[m[2].toLowerCase()] ? `${m[3]}-${mo[m[2].toLowerCase()]}-${String(m[1]).padStart(2,'0')}` : null;
  }
  function formatDateHeader(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const wk = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${wk[d.getDay()]}, ${d.getDate()} ${mo[d.getMonth()]} ${d.getFullYear()}`;
  }

  // ======== Create item ========
  function createItem(dl) {
    const overdue = new Date(`${dl.date}T${dl.time}`) < new Date();
    const linkUrl = dl.autolabUrl || '#';
    const src = dl.source === 'autolab' ? 'Autolab' : 'iSpace';
    const srcBg = dl.source === 'autolab' ? '#7c3aed' : '#059669';
    const open = linkUrl !== '#' ? 'target="_blank"' : '';
    const icon = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%237c3aed'/><stop offset='100%' stop-color='%23a855f7'/></linearGradient></defs><rect width='24' height='24' rx='5' fill='url(%23g)'/><circle cx='12' cy='11.5' r='6' fill='none' stroke='white' stroke-width='1.6'/><line x1='12' y1='8.5' x2='12' y2='12' stroke='white' stroke-width='1.6' stroke-linecap='round'/><line x1='12' y1='12' x2='14.5' y2='13.5' stroke='white' stroke-width='1.6' stroke-linecap='round'/><circle cx='12' cy='20' r='1' fill='white'/></svg>`);

    const div = document.createElement('div');
    div.className = 'list-group-item timeline-event-list-item flex-column pt-2 pb-0 border-0 px-2';
    div.setAttribute(TAG, dl.id);
    div.setAttribute('data-region', 'event-list-item');
    div.style.background = overdue ? '#fef2f2' : '#faf5ff';

    div.innerHTML = `
      <div class="d-flex flex-wrap pb-1">
        <div class="d-flex mr-auto pb-1 mw-100 timeline-name">
          <small class="text-right text-nowrap align-self-center ml-1">${esc(dl.time)}</small>
          <div class="activityiconcontainer small assessment courseicon align-self-top align-self-center mx-3 mb-1 mb-sm-0 text-nowrap">
            <img alt="Autolab" title="Autolab" class="icon " style="width:24px;height:24px;" src="data:image/svg+xml,${icon}">
          </div>
          <div class="event-name-container flex-grow-1 line-height-3 nowrap text-truncate">
            <div class="d-flex"><h6 class="event-name mb-0 pb-1 text-truncate"><a href="${esc(linkUrl)}" ${open} title="${esc(dl.assignment)} is due">${esc(dl.assignment)}</a></h6></div>
            <small class="mb-0">Assignment is due · ${esc(dl.courseName || '')}<span style="display:inline-block;padding:0 4px;border-radius:3px;font-size:0.6rem;font-weight:700;color:#fff;background:${srcBg};vertical-align:1px;margin-left:2px;">${src}</span></small>
          </div>
        </div>
        <div class="d-flex timeline-action-button" style="gap:6px;align-items:center;">
          <button class="ddl-mark-done btn btn-outline-secondary btn-sm text-nowrap" style="font-size:0.7rem;color:#059669;border-color:#86efac;" title="标记完成">✓</button>
          ${overdue
            ? '<span class="btn btn-outline-danger btn-sm text-nowrap" style="pointer-events:none;font-size:0.7rem;">Overdue</span>'
            : `<a class="list-group-item-action btn btn-outline-secondary btn-sm text-nowrap" href="${esc(linkUrl)}" ${open} style="font-size:0.7rem;">View on Autolab</a>`}
        </div>
      </div>
      <div class="pt-2 border-bottom"></div>`;

    div.querySelector('.ddl-mark-done').addEventListener('click', () => {
      div.style.transition = 'opacity 0.3s, transform 0.3s';
      div.style.opacity = '0';
      div.style.transform = 'translateX(20px)';
      markDone(dl.id);
      setTimeout(() => div.remove(), 300);
    });

    return div;
  }

  function clearInjected(wrapper) { wrapper.querySelectorAll(`[${TAG}]`).forEach(el => el.remove()); }

  // ======== Inject ========
  async function injectIntoTimeline(deadlines) {
    if (!deadlines.length) return;
    const doneIds = await getDoneIds();
    const cutoff = new Date(Date.now() - 3 * 86400000);
    const visible = deadlines.filter(d => new Date(`${d.date}T${d.time}`) > cutoff && !doneIds.has(d.id));
    const wrapper = document.querySelector('[data-region="event-list-wrapper"]');
    if (!wrapper) return;
    clearInjected(wrapper);
    if (!visible.length) return;

    const groups = getDateGroups(wrapper);
    const byDate = {};
    visible.forEach(dl => { if (!byDate[dl.date]) byDate[dl.date] = []; byDate[dl.date].push(dl); });
    Object.values(byDate).forEach(arr => arr.sort((a, b) => a.time.localeCompare(b.time)));

    Object.keys(byDate).sort().forEach(dateStr => {
      const dls = byDate[dateStr];
      const existing = groups.find(g => g.dateStr === dateStr);
      if (existing?.listEl) {
        dls.forEach(dl => existing.listEl.appendChild(createItem(dl)));
      } else {
        let before = null;
        for (const g of groups) { if (g.dateStr > dateStr) { before = g.headerEl; break; } }
        const hDiv = document.createElement('div');
        hDiv.className = 'mt-3'; hDiv.setAttribute('data-region', 'event-list-content-date');
        hDiv.setAttribute('data-timestamp', dateStrToTimestamp(dateStr)); hDiv.setAttribute(TAG, 'h-' + dateStr);
        hDiv.innerHTML = `<h5 class="h6 d-inline font-weight-bold px-2">${esc(formatDateHeader(dateStr))}</h5>`;
        const lDiv = document.createElement('div');
        lDiv.className = 'list-group list-group-flush'; lDiv.setAttribute(TAG, 'l-' + dateStr);
        dls.forEach(dl => lDiv.appendChild(createItem(dl)));
        if (before) { wrapper.insertBefore(lDiv, before); wrapper.insertBefore(hDiv, lDiv); }
        else { wrapper.appendChild(hDiv); wrapper.appendChild(lDiv); }
      }
    });

    const noEv = document.querySelector('[data-region="no-events-empty-message"]');
    if (noEv) noEv.classList.add('hidden');
  }

  // ======== Sync button ========
  function injectSyncButton() {
    if (document.querySelector('#ddl-sync-btn')) return;
    const titleEl = document.querySelector('.block_timeline .card-title, [data-block="timeline"] .card-title');
    if (!titleEl) return;
    const btn = document.createElement('button');
    btn.id = 'ddl-sync-btn';
    btn.title = '从 Autolab 同步 DDL';
    btn.style.cssText = 'border:none;background:linear-gradient(135deg,#ec4899,#f472b6);color:#fff;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;margin-left:8px;vertical-align:middle;transition:all 0.2s;';
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:3px;"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>Sync`;
    btn.onmouseenter = () => btn.style.opacity = '0.85';
    btn.onmouseleave = () => btn.style.opacity = '1';
    btn.addEventListener('click', async () => {
      btn.innerHTML = '<span style="display:inline-block;width:11px;height:11px;border:2px solid rgba(255,255,255,0.4);border-top-color:#fff;border-radius:50%;animation:ddl-spin 0.6s linear infinite;vertical-align:-1px;margin-right:3px;"></span>...';
      btn.style.pointerEvents = 'none';
      const result = await syncAllAutolab();
      if (result.error === 'no_urls') { btn.innerHTML = '未配置 URL'; btn.style.background = '#9ca3af'; }
      else { btn.innerHTML = `✓ ${result.count}`; const dls = await getDeadlines(); injectIntoTimeline(dls); }
      btn.style.pointerEvents = '';
      setTimeout(() => {
        btn.style.background = 'linear-gradient(135deg,#ec4899,#f472b6)';
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:3px;"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>Sync`;
      }, 3000);
    });
    titleEl.parentElement.appendChild(btn);
  }

  // ======== Wait + init ========
  function waitForTimeline(cb) {
    let called = false;
    const fire = () => { if (!called) { called = true; cb(); } };
    const check = () => {
      const w = document.querySelector('[data-region="event-list-wrapper"]');
      if (w?.children.length > 0) { fire(); return true; }
      if (document.querySelector('[data-region="no-events-empty-message"]:not(.hidden)')) { fire(); return true; }
      return false;
    };
    if (check()) return;
    const obs = new MutationObserver(() => { if (check()) obs.disconnect(); });
    const c = document.querySelector('[data-region="event-list-container"]') || document.querySelector('[data-region="timeline"]');
    if (c) obs.observe(c, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); fire(); }, 10000);
  }

  function injectCSS() {
    if (!document.getElementById('ddl-css')) {
      const s = document.createElement('style'); s.id = 'ddl-css';
      s.textContent = '@keyframes ddl-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
  }

  async function init() {
    injectCSS();
    // Sync button (doesn't need timeline to be loaded)
    const waitTitle = () => {
      const t = document.querySelector('.block_timeline .card-title, [data-block="timeline"] .card-title');
      if (t) { injectSyncButton(); return; }
      const o = new MutationObserver(() => { if (document.querySelector('.block_timeline .card-title, [data-block="timeline"] .card-title')) { o.disconnect(); injectSyncButton(); } });
      o.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => o.disconnect(), 5000);
    };
    waitTitle();

    const dls = await getDeadlines();
    if (dls.length > 0) waitForTimeline(() => injectIntoTimeline(dls));
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);

  chrome.storage.onChanged.addListener(async c => {
    if (c.deadlines || c.doneIds) {
      const dls = await getDeadlines();
      waitForTimeline(() => injectIntoTimeline(dls));
    }
  });
})();
