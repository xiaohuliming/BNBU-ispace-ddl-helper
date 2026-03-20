// content-course.js — Detect Autolab URLs (bound to course) + scrape iSpace dates
(function () {
  'use strict';

  const courseId = new URLSearchParams(location.search).get('id') || 'unknown';
  const courseName =
    document.querySelector('.page-header-headings h1')?.textContent?.trim() ||
    document.querySelector('header h1, .page-header h1, #page-header h1')?.textContent?.trim() ||
    document.title.replace(/:.*/, '').trim() || 'Unknown Course';

  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_URL', url }, resp => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!resp || !resp.ok) reject(new Error(resp?.error || 'Fetch failed'));
        else resolve(resp.html);
      });
    });
  }

  // ======== 1. Scrape iSpace visible due dates ========
  function scrapeISpaceDates() {
    const deadlines = [];
    document.querySelectorAll('[data-region="activity-dates"]').forEach(region => {
      const dueLine = [...region.querySelectorAll('div')].find(d =>
        d.querySelector('strong')?.textContent?.includes('Due'));
      if (!dueLine) return;
      const parsed = parseMoodleDate(dueLine.textContent.replace('Due:', '').trim());
      if (!parsed) return;
      const activity = region.closest('.activity-item, .activity, li[id^="module-"]');
      const name = activity?.querySelector('.instancename')?.childNodes?.[0]?.textContent?.trim()
        || activity?.querySelector('.activityname, .activity-name-area .aalink')?.textContent?.trim()
        || activity?.getAttribute('data-activityname') || 'Unknown';
      deadlines.push({
        id: `ispace-${courseId}-${name}`.replace(/\s+/g, '_'),
        date: fmtDate(parsed), time: fmtTime(parsed),
        assignment: name, courseName, courseId,
        source: 'ispace', scannedAt: new Date().toISOString(),
      });
    });
    return deadlines;
  }

  // ======== 2. Detect Autolab URLs → save with course binding ========
  function detectAutolabURLs() {
    const found = new Set();
    document.querySelectorAll('a[href*="172.31.12.111"]').forEach(link => {
      let url = (link.getAttribute('href') || '').trim().replace(/[)}\]]+$/, '');
      if (!url.startsWith('http')) url = 'http://' + url;
      found.add(url);
    });
    const matches = document.body.innerText.matchAll(/(?:https?:\/\/)?172\.31\.12\.111(?:\/courses(?:\/[\w-]+)?)?/g);
    for (const m of matches) {
      let url = m[0].replace(/[)}\]]+$/, '');
      if (!url.startsWith('http')) url = 'http://' + url;
      found.add(url);
    }
    return [...found];
  }

  async function saveDetectedUrls(detectedUrls) {
    if (!detectedUrls.length) return;
    return new Promise(resolve => {
      chrome.storage.local.get('autolabUrls', data => {
        const existing = data.autolabUrls || [];
        let changed = false;
        for (const url of detectedUrls) {
          const idx = existing.findIndex(e => e.url === url);
          if (idx < 0) {
            existing.push({ url, source: 'auto', ispaceCourse: courseName, ispaceId: courseId });
            changed = true;
          } else if (!existing[idx].ispaceCourse) {
            existing[idx].ispaceCourse = courseName;
            existing[idx].ispaceId = courseId;
            changed = true;
          }
        }
        if (changed) chrome.storage.local.set({ autolabUrls: existing }, resolve);
        else resolve();
      });
    });
  }

  // ======== 3. Fetch & parse single Autolab URL ========
  async function fetchAutolabDeadlines(autolabBaseUrl) {
    let url = autolabBaseUrl;
    if (!url.includes('/courses')) url += '/courses';
    url = url.replace(/\/+$/, '');

    const html = await bgFetch(url);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let allDls = parseAutolabPage(doc, url);

    if (allDls.length === 0) {
      const courseUrls = new Set();
      doc.querySelectorAll('a[href*="/courses/"]').forEach(link => {
        const m = link.getAttribute('href')?.match(/^(\/courses\/[\w-]+)\/?$/);
        if (m) { const base = url.match(/^https?:\/\/[^/]+/)?.[0] || 'http://172.31.12.111'; courseUrls.add(base + m[1]); }
      });
      for (const cu of courseUrls) {
        try { const h = await bgFetch(cu); allDls.push(...parseAutolabPage(parser.parseFromString(h, 'text/html'), cu)); }
        catch (e) { console.warn('[DDL Helper] Failed:', cu, e.message); }
      }
    }
    return allDls;
  }

  function parseAutolabPage(doc, pageUrl) {
    const deadlines = [];
    const pageCourse = doc.querySelector('.card-title b')?.textContent?.trim()
      || doc.querySelector('.card-title')?.textContent?.trim()
      || doc.querySelector('.sub-navigation .title')?.textContent?.trim()
      || doc.querySelector('h1, h2, .course-title')?.textContent?.trim() || '';
    // Extract course slug from URL as stable identifier
    const courseSlug = pageUrl.match(/\/courses\/([\w-]+)/)?.[1] || '';
    doc.querySelectorAll('a.collection-item').forEach(item => {
      const datePara = item.querySelector('p.date');
      if (!datePara) return;
      const dueMatch = datePara.textContent.match(/Due:\s*(.+?)$/m);
      if (!dueMatch) return;
      const parsed = parseAutolabDate(dueMatch[1].trim());
      if (!parsed) return;
      let name = '';
      for (const node of item.childNodes) { if (node.nodeType === Node.TEXT_NODE) { const t = node.textContent.trim(); if (t) { name = t; break; } } }
      if (!name) name = item.textContent.split('\n')[0].trim() || 'Unknown';
      const href = item.getAttribute('href') || '';
      const base = pageUrl.match(/^https?:\/\/[^/]+/)?.[0] || 'http://172.31.12.111';
      deadlines.push({
        id: `autolab-${courseSlug || courseId}-${name}`.replace(/\s+/g, '_'),
        date: fmtDate(parsed), time: fmtTime(parsed),
        assignment: name, courseName: pageCourse || courseName, courseId,
        source: 'autolab', autolabUrl: href.startsWith('http') ? href : base + href,
        scannedAt: new Date().toISOString(),
      });
    });
    return deadlines;
  }

  // ======== Date helpers ========
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
  function parseMoodleDate(str) {
    const d = new Date(str);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2020) return d;
    const m = str.match(/(\d+)\s+(\w+)\s+(\d{4}),?\s+(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return null;
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const mi = months.findIndex(mn => mn.startsWith(m[2].toLowerCase()));
    if (mi < 0) return null;
    let h = parseInt(m[4]);
    if (m[6].toUpperCase() === 'PM' && h < 12) h += 12;
    if (m[6].toUpperCase() === 'AM' && h === 12) h = 0;
    return new Date(parseInt(m[3]), mi, parseInt(m[1]), h, parseInt(m[5]));
  }
  function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function fmtTime(d) { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

  async function saveDeadlines(newDls) {
    return new Promise(resolve => {
      chrome.storage.local.get('deadlines', data => {
        const merged = [...(data.deadlines || [])];
        for (const nd of newDls) { const idx = merged.findIndex(e => e.id === nd.id); if (idx >= 0) merged[idx] = nd; else merged.push(nd); }
        merged.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
        chrome.storage.local.set({ deadlines: merged }, () => resolve(merged));
      });
    });
  }

  // ======== UI ========
  function injectSyncButton(detectedUrls) {
    if (document.querySelector('.ddl-fab-container')) return;
    const container = document.createElement('div');
    container.className = 'ddl-fab-container';
    container.innerHTML = `<button class="ddl-scan-all-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>从 Autolab 同步 DDL</span></button>`;
    document.body.appendChild(container);
    container.querySelector('.ddl-scan-all-btn').addEventListener('click', async () => {
      const btn = container.querySelector('.ddl-scan-all-btn');
      btn.innerHTML = '<span class="ddl-spinner"></span> 同步中...'; btn.style.pointerEvents = 'none';
      try {
        const ispaceDls = scrapeISpaceDates();
        let autolabDls = [];
        for (const url of detectedUrls) {
          try { autolabDls.push(...await fetchAutolabDeadlines(url)); } catch (e) { console.warn('[DDL Helper]', url, e.message); }
        }
        const all = [...ispaceDls, ...autolabDls];
        if (all.length > 0) await saveDeadlines(all);
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg><span>已同步 ${all.length} 个 DDL</span>`;
      } catch (e) { btn.innerHTML = '<span>同步失败</span>'; }
      btn.style.pointerEvents = '';
      setTimeout(() => { btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>从 Autolab 同步 DDL</span>`; }, 5000);
    });
  }

  async function init() {
    const ispaceDls = scrapeISpaceDates();
    if (ispaceDls.length > 0) saveDeadlines(ispaceDls);
    const detectedUrls = detectAutolabURLs();
    console.log('[DDL Helper] Detected Autolab URLs:', detectedUrls);
    await saveDetectedUrls(detectedUrls);
    injectSyncButton(detectedUrls);
  }

  if (document.readyState === 'complete') setTimeout(init, 500);
  else window.addEventListener('load', () => setTimeout(init, 500));
})();
