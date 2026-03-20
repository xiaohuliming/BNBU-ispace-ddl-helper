// background.js — Fetch Autolab pages (bypasses CORS) + badge + auto sync

// ======== Alarms ========
chrome.alarms.create('badge', { periodInMinutes: 30 });
chrome.alarms.create('autoSync', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'badge') {
    await updateBadge();
  } else if (alarm.name === 'autoSync') {
    console.log('[DDL Helper] Auto-sync triggered');
    await autoSyncAutolab();
    await updateBadge();
  }
});

async function updateBadge() {
  const { deadlines = [] } = await chrome.storage.local.get('deadlines');
  const now = Date.now();
  const urgent = deadlines.filter(d => {
    const diff = new Date(`${d.date}T${d.time}`) - now;
    return diff > 0 && diff < 3 * 86400000;
  });
  chrome.action.setBadgeText({ text: urgent.length > 0 ? `${urgent.length}` : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
}

// ======== Auto Sync ========
function parseAutolabDate(str) {
  const m = str.trim().match(/(\w+)\s+(\d+)\s+at\s+(\d+):(\d+)(am|pm)/i);
  if (!m) return null;
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mi = months.indexOf(m[1].toLowerCase().substring(0, 3));
  if (mi < 0) return null;
  let h = parseInt(m[3]);
  if (m[5].toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[5].toLowerCase() === 'am' && h === 12) h = 0;
  let year = new Date().getFullYear();
  const candidate = new Date(year, mi, parseInt(m[2]), h, parseInt(m[4]));
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  if (candidate < twoMonthsAgo) year += 1;
  return new Date(year, mi, parseInt(m[2]), h, parseInt(m[4]));
}
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtTime(d) { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

async function fetchAndParseAutolab(baseUrl) {
  let url = baseUrl;
  if (!url.includes('/courses')) url += '/courses';
  url = url.replace(/\/+$/, '');
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  // Use regex-based parsing since DOMParser is unavailable in service workers
  const dls = [];
  const courseSlug = url.match(/\/courses\/([\w-]+)/)?.[1] || '';
  // Match collection-item blocks: extract assignment name and due date
  const itemRegex = /<a[^>]*class="[^"]*collection-item[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const href = match[1];
    const content = match[2];
    const dueMatch = content.match(/Due:\s*(.+?)(?:<|$)/m);
    if (!dueMatch) continue;
    const parsed = parseAutolabDate(dueMatch[1].trim());
    if (!parsed) continue;
    // Extract assignment name (text before the first <p> or <span>)
    const nameMatch = content.match(/^\s*([^<]+)/);
    let name = nameMatch ? nameMatch[1].trim() : 'Unknown';
    if (!name) name = 'Unknown';
    const base = url.match(/^https?:\/\/[^/]+/)?.[0] || 'http://172.31.12.111';
    dls.push({
      id: `autolab-${courseSlug || 'bg'}-${name}`.replace(/\s+/g, '_'),
      date: fmtDate(parsed), time: fmtTime(parsed),
      assignment: name, courseName: courseSlug, courseId: 'bg-sync',
      source: 'autolab',
      autolabUrl: href.startsWith('http') ? href : base + href,
      scannedAt: new Date().toISOString(),
    });
  }
  // If no items found on this page, try discovering course sub-pages
  if (dls.length === 0) {
    const courseLinks = new Set();
    const linkRegex = /href="(\/courses\/[\w-]+)\/?"/g;
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) courseLinks.add(lm[1]);
    const base = url.match(/^https?:\/\/[^/]+/)?.[0] || 'http://172.31.12.111';
    for (const path of courseLinks) {
      try {
        const r2 = await fetch(base + path, { redirect: 'follow' });
        if (!r2.ok) continue;
        const h2 = await r2.text();
        const slug2 = path.match(/\/courses\/([\w-]+)/)?.[1] || '';
        let m2;
        const re2 = /<a[^>]*class="[^"]*collection-item[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((m2 = re2.exec(h2)) !== null) {
          const dm2 = m2[2].match(/Due:\s*(.+?)(?:<|$)/m);
          if (!dm2) continue;
          const p2 = parseAutolabDate(dm2[1].trim());
          if (!p2) continue;
          const nm2 = m2[2].match(/^\s*([^<]+)/);
          let n2 = nm2 ? nm2[1].trim() : 'Unknown';
          dls.push({
            id: `autolab-${slug2 || 'bg'}-${n2}`.replace(/\s+/g, '_'),
            date: fmtDate(p2), time: fmtTime(p2),
            assignment: n2, courseName: slug2, courseId: 'bg-sync',
            source: 'autolab',
            autolabUrl: m2[1].startsWith('http') ? m2[1] : base + m2[1],
            scannedAt: new Date().toISOString(),
          });
        }
      } catch (e) { console.warn('[DDL Helper] bg sub-fetch failed:', path, e.message); }
    }
  }
  return dls;
}

async function autoSyncAutolab() {
  try {
    const { autolabUrls = [] } = await chrome.storage.local.get('autolabUrls');
    if (!autolabUrls.length) return;
    let all = [];
    for (const u of autolabUrls) {
      try { all.push(...await fetchAndParseAutolab(u.url)); }
      catch (e) { console.warn('[DDL Helper] bg sync failed:', u.url, e.message); }
    }
    if (all.length > 0) {
      const { deadlines = [] } = await chrome.storage.local.get('deadlines');
      const merged = [...deadlines];
      for (const nd of all) {
        const idx = merged.findIndex(e => e.id === nd.id);
        if (idx >= 0) merged[idx] = nd; else merged.push(nd);
      }
      merged.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));
      await chrome.storage.local.set({ deadlines: merged });
      console.log(`[DDL Helper] Auto-synced ${all.length} deadlines`);
    }
  } catch (e) { console.error('[DDL Helper] Auto-sync error:', e); }
}

// Run sync on install/startup
chrome.runtime.onInstalled.addListener(() => { autoSyncAutolab(); updateBadge(); });
chrome.runtime.onStartup.addListener(() => { autoSyncAutolab(); updateBadge(); });

// ======== Message handlers ========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CLEAR_DEADLINES') {
    chrome.storage.local.set({ deadlines: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  // Fetch a URL from background (no CORS restrictions with host_permissions)
  if (msg.type === 'FETCH_URL') {
    fetch(msg.url, { redirect: 'follow' })
      .then(resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then(html => sendResponse({ ok: true, html }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  // Manual trigger for sync from popup or content script
  if (msg.type === 'TRIGGER_SYNC') {
    autoSyncAutolab().then(() => updateBadge()).then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
