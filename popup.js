const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ======== Tabs ========
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  });
});

function status(date, time) {
  const diff = new Date(`${date}T${time}`) - new Date();
  if (diff < 0) return { t: 'Overdue', c: 'overdue' };
  const h = diff / 3600000;
  if (h < 24) return { t: `${Math.ceil(h)}h`, c: 'urgent' };
  const d = h / 24;
  if (d < 3) return { t: `${Math.ceil(d)}d`, c: 'urgent' };
  if (d < 7) return { t: `${Math.ceil(d)}d`, c: 'normal' };
  return { t: `${Math.ceil(d)}d`, c: 'later' };
}

// ======== Deadlines ========
function renderDLs(deadlines, doneIds) {
  const el = document.getElementById('dl-list');
  const done = new Set(doneIds || []);
  const cutoff = new Date(Date.now() - 7 * 86400000);
  const vis = (deadlines || []).filter(d => new Date(`${d.date}T${d.time}`) > cutoff && !done.has(d.id));
  document.getElementById('dl-count').textContent = vis.length;
  if (!vis.length) { el.innerHTML = '<div class="empty">暂无未完成的 DDL</div>'; return; }
  el.innerHTML = '';
  vis.forEach(d => {
    const dt = new Date(`${d.date}T${d.time}`);
    const s = status(d.date, d.time);
    const srcCls = d.source === 'autolab' ? 'src-autolab' : 'src-ispace';
    const srcLabel = d.source === 'autolab' ? 'AL' : 'iS';
    const div = document.createElement('div');
    div.className = 'dl-item';
    div.innerHTML = `
      <div class="dl-date"><div class="month">${M[dt.getMonth()]}</div><div class="day">${dt.getDate()}</div></div>
      <div class="dl-info"><div class="dl-name">${d.assignment}<span class="src ${srcCls}">${srcLabel}</span></div><div class="dl-meta">${d.courseName || ''} · ${d.time}</div></div>
      <button class="dl-done-btn" data-id="${d.id}">✓ Done</button>
      <span class="dl-status ${s.c}">${s.t}</span>`;
    div.querySelector('.dl-done-btn').addEventListener('click', () => markDone(d.id));
    el.appendChild(div);
  });
}

function markDone(id) {
  chrome.storage.local.get('doneIds', data => {
    const ids = new Set(data.doneIds || []);
    ids.add(id);
    chrome.storage.local.set({ doneIds: [...ids] });
  });
}

function markUndone(id) {
  chrome.storage.local.get('doneIds', data => {
    const ids = new Set(data.doneIds || []);
    ids.delete(id);
    chrome.storage.local.set({ doneIds: [...ids] });
  });
}

// ======== Done list ========
function renderDone(deadlines, doneIds) {
  const el = document.getElementById('done-list');
  const done = new Set(doneIds || []);
  const completed = (deadlines || []).filter(d => done.has(d.id));
  document.getElementById('done-count').textContent = completed.length;
  if (!completed.length) { el.innerHTML = '<div class="empty">暂无已完成项</div>'; return; }
  el.innerHTML = '';
  completed.forEach(d => {
    const dt = new Date(`${d.date}T${d.time}`);
    const div = document.createElement('div');
    div.className = 'dl-item done-row';
    div.innerHTML = `
      <div class="dl-date"><div class="month">${M[dt.getMonth()]}</div><div class="day">${dt.getDate()}</div></div>
      <div class="dl-info"><div class="dl-name">${d.assignment}</div><div class="dl-meta">${d.courseName || ''} · ${d.time}</div></div>
      <button class="dl-undo-btn" data-id="${d.id}">Undo</button>
      <span class="dl-status done-status">Done</span>`;
    div.querySelector('.dl-undo-btn').addEventListener('click', () => markUndone(d.id));
    el.appendChild(div);
  });
}

// ======== URLs ========
async function getUrls() { return new Promise(r => chrome.storage.local.get('autolabUrls', d => r(d.autolabUrls || []))); }
async function saveUrls(urls) { return new Promise(r => chrome.storage.local.set({ autolabUrls: urls }, r)); }

function renderUrls(urls) {
  const el = document.getElementById('url-list');
  document.getElementById('url-count').textContent = urls.length;
  if (!urls.length) { el.innerHTML = '<div class="empty">暂无 · 进入课程页面自动检测或手动添加</div>'; return; }
  el.innerHTML = '';
  urls.forEach((u, i) => {
    const badge = u.source === 'auto' ? '<span class="url-badge url-badge-auto">自动</span>' : '<span class="url-badge url-badge-manual">手动</span>';
    const course = u.ispaceCourse ? `<span class="url-course" title="${u.ispaceCourse}">← ${u.ispaceCourse}</span>` : '';
    const div = document.createElement('div');
    div.className = 'url-item';
    div.innerHTML = `${badge}<span class="url-text" title="${u.url}">${u.url}</span>${course}<button class="url-del" title="删除">×</button>`;
    div.querySelector('.url-del').addEventListener('click', async () => { urls.splice(i, 1); await saveUrls(urls); renderUrls(urls); });
    el.appendChild(div);
  });
}

// ======== Init ========
async function loadAll() {
  const [{ deadlines = [] }, { doneIds = [] }] = await Promise.all([
    new Promise(r => chrome.storage.local.get('deadlines', r)),
    new Promise(r => chrome.storage.local.get('doneIds', r)),
  ]);
  renderDLs(deadlines, doneIds);
  renderDone(deadlines, doneIds);
  renderUrls(await getUrls());
}

document.getElementById('addBtn').addEventListener('click', async () => {
  let url = document.getElementById('newUrl').value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'http://' + url;
  url = url.replace(/[)}\]]+$/, '');
  const urls = await getUrls();
  if (urls.some(u => u.url === url)) return;
  urls.push({ url, source: 'manual' });
  await saveUrls(urls);
  renderUrls(urls);
  document.getElementById('newUrl').value = '';
});

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('清空所有 DDL？')) chrome.storage.local.set({ deadlines: [], doneIds: [] }, loadAll);
});

chrome.storage.onChanged.addListener(() => loadAll());
loadAll();
