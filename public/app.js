// Personal Brand OS — single page frontend

const $ = (id) => document.getElementById(id);

const btnIdeas = $('btn-ideas');
const progress = $('progress');
const progressLog = $('progress-log');
const errorBox = $('error-box');
const ideasWrap = $('ideas');
const ideaCards = $('idea-cards');
const results = $('results');
const resultTopic = $('result-topic');
const resultBlocks = $('result-blocks');

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function showError(msg) {
  errorBox.textContent = msg;
  show(errorBox);
}

function resetGenerate() {
  hide(progress); hide(errorBox); hide(ideasWrap); hide(results);
  btnIdeas.disabled = false;
  show(btnIdeas);
}

// ---------- SSE helper ----------

function streamSSE(url, { onProgress, onDone, onFail }) {
  const es = new EventSource(url);
  es.addEventListener('progress', (e) => onProgress(JSON.parse(e.data).message));
  es.addEventListener('done', (e) => { es.close(); onDone(JSON.parse(e.data)); });
  es.addEventListener('failed', (e) => { es.close(); onFail(JSON.parse(e.data).error); });
  es.onerror = () => { es.close(); onFail('Lost connection to the app. Is it still running? Try refreshing the page.'); };
}

// ---------- Step 1: ideas ----------

btnIdeas.addEventListener('click', () => {
  hide(btnIdeas); hide(errorBox); hide(ideasWrap); hide(results);
  show(progress);
  progressLog.textContent = 'Starting...';
  btnIdeas.disabled = true;

  streamSSE('/api/ideas', {
    onProgress: (msg) => { progressLog.textContent = msg; },
    onDone: (data) => { hide(progress); renderIdeas(data.ideas); },
    onFail: (msg) => { hide(progress); showError(msg); btnIdeas.disabled = false; show(btnIdeas); },
  });
});

let lastIdeas = null;

function renderIdeas(ideas) {
  lastIdeas = ideas;
  ideaCards.innerHTML = '';
  ideas.forEach((idea) => {
    const s = idea.scores || {};
    const card = document.createElement('div');
    card.className = 'idea-card';
    card.innerHTML = `
      <span class="cat">${esc(idea.category || 'other')}</span>
      <h3>${esc(idea.topic)}</h3>
      <p class="why">${esc(idea.whyItMatters || '')}</p>
      <p class="scores">Originality ${s.originality ?? '–'}/10 · Engagement ${s.engagement ?? '–'}/10 · Brand fit ${s.brandAlignment ?? '–'}/10 · Long-term ${s.longTermValue ?? '–'}/10</p>
    `;
    const btn = document.createElement('button');
    btn.textContent = 'Write this one →';
    btn.addEventListener('click', () => writePosts(idea));
    card.appendChild(btn);
    ideaCards.appendChild(card);
  });
  show(ideasWrap);
}

// ---------- Step 2: posts ----------

async function writePosts(idea) {
  hide(ideasWrap); hide(errorBox);
  show(progress);
  progressLog.textContent = 'Preparing to write...';

  try {
    const r = await fetch('/api/posts/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Could not start.');
  } catch (err) {
    hide(progress); showError(err.message); resetGenerate();
    return;
  }

  streamSSE('/api/posts/stream', {
    onProgress: (msg) => { progressLog.textContent = msg; },
    onDone: (data) => { hide(progress); renderResults(data.entry); loadHistory(); },
    onFail: (msg) => { hide(progress); showError(msg); btnIdeas.disabled = false; show(btnIdeas); },
  });
}

function block(title, bodyHtml, copyText, badge) {
  const div = document.createElement('div');
  div.className = 'block';
  const head = document.createElement('div');
  head.className = 'block-head';
  head.innerHTML = `<h3>${esc(title)}</h3>`;
  if (badge) head.innerHTML += `<span class="score-badge">${esc(badge)}</span>`;
  if (copyText) {
    const btn = document.createElement('button');
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(copyText);
      btn.textContent = 'Copied ✓';
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
    head.appendChild(btn);
  }
  div.appendChild(head);
  const body = document.createElement('div');
  body.innerHTML = bodyHtml;
  div.appendChild(body);
  return div;
}

function renderResults(entry) {
  const d = entry.drafts;
  resultTopic.textContent = entry.topic;
  resultBlocks.innerHTML = '';

  const badge = d.score ? `Quality ${d.score}/100${d.rewritten ? ' (auto-improved)' : ''}` : '';
  resultBlocks.appendChild(block('LinkedIn post', `<pre>${esc(d.linkedin)}</pre>`, d.linkedin, badge));
  resultBlocks.appendChild(block('X post', `<pre>${esc(d.x)}</pre>`, d.x));
  resultBlocks.appendChild(block('Alternative hooks', `<ul>${(d.hooks || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`, (d.hooks || []).join('\n')));
  resultBlocks.appendChild(block('Comments you can leave elsewhere', `<ul>${(d.comments || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`, (d.comments || []).join('\n')));
  resultBlocks.appendChild(block('Best posting time', `<pre>${esc(d.bestPostingTime || '')}</pre>`));
  if (entry.idea?.sources?.length) {
    resultBlocks.appendChild(block('Sources', `<ul>${entry.idea.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>`));
  }
  show(results);
}

$('btn-restart').addEventListener('click', resetGenerate);

$('btn-back-ideas').addEventListener('click', () => {
  hide(results); hide(errorBox);
  if (lastIdeas) {
    renderIdeas(lastIdeas);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    resetGenerate();
  }
});

$('btn-home').addEventListener('click', () => {
  resetGenerate();
  hide($('settings-body'));
  loadHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- History ----------

// Expandable full view of a saved entry — same blocks as the results screen.
function buildEntryDetails(e) {
  const d = e.drafts || {};
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'View everything (posts, hooks, comments...)';
  details.appendChild(summary);
  const body = document.createElement('div');
  body.style.marginTop = '10px';
  details.appendChild(body);

  let rendered = false;
  details.addEventListener('toggle', () => {
    if (!details.open || rendered) return;
    rendered = true;
    const badge = d.score ? `Quality ${d.score}/100${d.rewritten ? ' (auto-improved)' : ''}` : '';
    body.appendChild(block('LinkedIn post', `<pre>${esc(d.linkedin || '')}</pre>`, d.linkedin, badge));
    body.appendChild(block('X post', `<pre>${esc(d.x || '')}</pre>`, d.x));
    if (d.hooks?.length) body.appendChild(block('Alternative hooks', `<ul>${d.hooks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`, d.hooks.join('\n')));
    if (d.comments?.length) body.appendChild(block('Comments you can leave elsewhere', `<ul>${d.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`, d.comments.join('\n')));
    if (d.bestPostingTime) body.appendChild(block('Best posting time', `<pre>${esc(d.bestPostingTime)}</pre>`));
    if (e.idea?.sources?.length) {
      body.appendChild(block('Sources', `<ul>${e.idea.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>`));
    }
  });
  return details;
}

async function loadHistory() {
  const r = await fetch('/api/history');
  const { entries } = await r.json();
  const list = $('history-list');
  if (!entries.length) {
    list.innerHTML = '<p class="hint">Nothing yet — generate your first post above.</p>';
    return;
  }
  list.innerHTML = '';
  [...entries].reverse().forEach((e) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const date = new Date(e.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const m = e.metrics || {};
    item.innerHTML = `
      <div class="top">
        <div>
          <strong>${esc(e.topic)}</strong>
          <div class="meta">${date} · ${esc(e.category || '')}</div>
        </div>
        <span class="status-${e.status === 'posted' ? 'posted' : 'draft'}">${e.status === 'posted' ? '✓ Posted' : 'Draft'}</span>
      </div>
    `;
    item.appendChild(buildEntryDetails(e));
    const row = document.createElement('div');
    row.className = 'metrics-row';
    if (e.status !== 'posted') {
      const btn = document.createElement('button');
      btn.className = 'ghost';
      btn.textContent = 'Mark as posted';
      btn.addEventListener('click', async () => {
        await fetch(`/api/history/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'posted' }) });
        loadHistory();
      });
      row.appendChild(btn);
    } else {
      ['likes', 'comments', 'impressions'].forEach((k) => {
        const label = document.createElement('label');
        label.textContent = k;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.placeholder = '0';
        if (m[k] != null) input.value = m[k];
        input.addEventListener('change', async () => {
          await fetch(`/api/history/${e.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metrics: { [k]: Number(input.value) } }) });
        });
        row.appendChild(label);
        row.appendChild(input);
      });
    }
    const del = document.createElement('button');
    del.className = 'ghost delete';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${e.topic}"? This cannot be undone.`)) return;
      await fetch(`/api/history/${e.id}`, { method: 'DELETE' });
      loadHistory();
    });
    row.appendChild(del);
    item.appendChild(row);
    list.appendChild(item);
  });
}

// ---------- Settings ----------

$('btn-settings-toggle').addEventListener('click', async () => {
  const body = $('settings-body');
  if (body.classList.contains('hidden')) {
    const r = await fetch('/api/settings');
    $('brand-rules').value = (await r.json()).brandRules;
    show(body);
  } else {
    hide(body);
  }
});

$('btn-save-settings').addEventListener('click', async () => {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandRules: $('brand-rules').value }),
  });
  $('settings-status').textContent = r.ok ? 'Saved ✓' : 'Could not save — rules cannot be empty.';
  setTimeout(() => ($('settings-status').textContent = ''), 2500);
});

$('btn-reset-settings').addEventListener('click', async () => {
  const r = await fetch('/api/settings/reset', { method: 'POST' });
  $('brand-rules').value = (await r.json()).brandRules;
  $('settings-status').textContent = 'Reset to default ✓';
  setTimeout(() => ($('settings-status').textContent = ''), 2500);
});

// ---------- util ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

loadHistory();
