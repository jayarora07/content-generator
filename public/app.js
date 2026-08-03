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

// ---------- Market ----------
// One market at a time. Remembered across refreshes; Home clears it.

const MARKET_INFO = {
  india: { flag: '🇮🇳', name: 'Indian market', metrics: ['likes', 'comments', 'impressions'] },
  global: { flag: '🌍', name: 'Global market', metrics: ['likes', 'comments', 'impressions'] },
  x: { flag: '𝕏', name: 'X (Twitter)', metrics: ['views', 'likes', 'replies', 'reposts', 'bookmarks'] },
};

const isX = () => market === 'x';

let market = null;

// Every API call must say which market it's for.
const withMarket = (url) => url + (url.includes('?') ? '&' : '?') + 'market=' + market;

function enterMarket(m) {
  if (!MARKET_INFO[m]) return;
  market = m;
  localStorage.setItem('pbos_market', m);
  lastIdeas = null;
  hide($('market-chooser'));
  show($('generate'));
  show($('history-section'));
  show($('settings-section'));
  show($('btn-home'));
  const label = $('market-label');
  label.textContent = `${MARKET_INFO[m].flag} ${MARKET_INFO[m].name}`;
  show(label);
  // The paste-a-link fast path only makes sense for X.
  (m === 'x' ? show : hide)($('react-panel'));
  $('btn-ideas').textContent = m === 'x' ? '✨ Find what to post about' : '✨ Get content ideas';
  resetGenerate();
  hide($('settings-body'));
  loadHistory();
}

function leaveMarket() {
  market = null;
  localStorage.removeItem('pbos_market');
  lastIdeas = null;
  resetGenerate();
  hide($('generate'));
  hide($('history-section'));
  hide($('settings-section'));
  hide($('settings-body'));
  hide($('btn-home'));
  hide($('market-label'));
  show($('market-chooser'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.market-card').forEach((card) => {
  card.addEventListener('click', () => enterMarket(card.dataset.market));
});

function showError(msg) {
  errorBox.textContent = msg;
  show(errorBox);
}

function resetGenerate() {
  hide(progress); hide(errorBox); hide(ideasWrap); hide(results); hide($('freshness'));
  btnIdeas.disabled = false;
  show(btnIdeas);
  if (isX()) show($('react-panel'));
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

  streamSSE(withMarket('/api/ideas'), {
    onProgress: (msg) => { progressLog.textContent = msg; },
    onDone: (data) => { hide(progress); renderIdeas(data.ideas, data.generatedAt); },
    onFail: (msg) => { hide(progress); showError(msg); btnIdeas.disabled = false; show(btnIdeas); },
  });
});

let lastIdeas = null;
let lastGeneratedAt = null;

// AI news goes stale fast — warn if you come back to an old batch.
function renderFreshness() {
  const el = $('freshness');
  if (!isX() || !lastGeneratedAt) { hide(el); return; }
  const hrs = (Date.now() - new Date(lastGeneratedAt).getTime()) / 3600000;
  if (hrs < 20) { hide(el); return; }
  const when = hrs < 48 ? 'yesterday' : `${Math.round(hrs / 24)} days ago`;
  el.textContent = `These ideas are from ${when}. AI news moves fast — consider generating a fresh batch.`;
  show(el);
}

function renderIdeas(ideas, generatedAt) {
  lastIdeas = ideas;
  if (generatedAt) lastGeneratedAt = generatedAt;
  renderFreshness();
  ideaCards.innerHTML = '';
  ideas.forEach((idea) => {
    const s = idea.scores || {};
    const card = document.createElement('div');
    card.className = 'idea-card';
    card.innerHTML = `
      <span class="cat">${esc(idea.category || 'other')}</span>
      <h3>${esc(idea.topic)}</h3>
      <p class="why">${esc(idea.whyItMatters || '')}</p>
      ${isX() && idea.newsDate ? `<p class="scores">${esc(idea.newsDate)}${idea.timeliness != null ? ` · still timely ${idea.timeliness}/10` : ''}</p>` : ''}
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
      body: JSON.stringify({ market, idea }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Could not start.');
  } catch (err) {
    hide(progress); showError(err.message); resetGenerate();
    return;
  }

  streamSSE(withMarket('/api/posts/stream'), {
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

// X posts have a different shape to LinkedIn ones — no hashtags, no second
// draft, but a screenshot to attach and a "post within" urgency.
function renderXBlocks(target, entry) {
  const d = entry.drafts;
  const words = (d.post || '').trim().split(/\s+/).filter(Boolean).length;
  const badge = [d.mode ? `${d.mode} · ${words} words` : '', d.timeliness != null ? `timely ${d.timeliness}/10` : '']
    .filter(Boolean).join(' · ');
  target.appendChild(block('The post', `<pre>${esc(d.post || '')}</pre>`, d.post, badge));
  if (d.receipt) target.appendChild(block('📸 Screenshot to attach', `<pre>${esc(d.receipt)}</pre>`, d.receipt));
  if (d.postWithin) target.appendChild(block('Post within', `<pre>${esc(d.postWithin)}</pre>`));
  if (d.hooks?.length) target.appendChild(block('Alternative openings', `<ul>${d.hooks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`, d.hooks.join('\n')));
  if (d.followUp) target.appendChild(block('Follow-up tweet', `<pre>${esc(d.followUp)}</pre>`, d.followUp));
  if (d.replies?.length) target.appendChild(block('Replies to leave on other posts', `<ul>${d.replies.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`, d.replies.join('\n')));
  if (d.linkPlan) target.appendChild(block('Link', `<pre>${esc(d.linkPlan)}</pre>`));
  const sources = d.sources?.length ? d.sources : entry.idea?.sources;
  if (sources?.length) {
    target.appendChild(block('Sources', `<ul>${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>`));
  }
}

function renderResults(entry) {
  const d = entry.drafts;
  resultTopic.textContent = entry.topic;
  resultBlocks.innerHTML = '';

  if ((entry.market || market) === 'x') {
    renderXBlocks(resultBlocks, entry);
    show(results);
    return;
  }

  const badge = d.score ? `Quality ${d.score}/100${d.rewritten ? ' (auto-improved)' : ''}` : '';
  resultBlocks.appendChild(block('LinkedIn post', `<pre>${esc(d.linkedin)}</pre>`, d.linkedin, badge));
  resultBlocks.appendChild(block('X post', `<pre>${esc(d.x)}</pre>`, d.x));
  resultBlocks.appendChild(block('Alternative hooks', `<ul>${(d.hooks || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`, (d.hooks || []).join('\n')));
  resultBlocks.appendChild(block('Comments you can leave elsewhere', `<ul>${(d.comments || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`, (d.comments || []).join('\n')));
  resultBlocks.appendChild(block('Best posting time', `<pre>${esc(d.bestPostingTime || '')}</pre>`));
  if (d.hashtags?.length) {
    resultBlocks.appendChild(block('Hashtags (for reach)', `<pre>${esc(d.hashtags.join(' '))}</pre>`, d.hashtags.join(' ')));
  }
  if (entry.idea?.sources?.length) {
    resultBlocks.appendChild(block('Sources', `<ul>${entry.idea.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>`));
  }
  show(results);
}

// X fast path: paste something you just saw → take.
$('btn-react').addEventListener('click', async () => {
  const input = $('react-input').value.trim();
  if (!input) { $('react-input').focus(); return; }
  const observation = $('react-observation').value.trim();
  const btn = $('btn-react');
  btn.disabled = true;
  btn.textContent = 'Checking the facts and writing...';
  hide(errorBox); hide(ideasWrap); hide(results);
  try {
    const r = await fetch('/api/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market, input, observation }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not write a take.');
    $('react-input').value = '';
    $('react-observation').value = '';
    renderResults(data.entry);
    loadHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Write a take';
  }
});

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

// Home goes back to the market chooser.
$('btn-home').addEventListener('click', leaveMarket);

// ---------- History ----------

// Expandable full view of a saved entry — same blocks as the results screen.
function buildEntryDetails(e) {
  const d = e.drafts || {};
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = isX()
    ? 'View everything (post, openings, replies...)'
    : 'View everything (posts, hooks, comments...)';
  details.appendChild(summary);
  const body = document.createElement('div');
  body.style.marginTop = '10px';
  details.appendChild(body);

  let rendered = false;
  details.addEventListener('toggle', () => {
    if (!details.open || rendered) return;
    rendered = true;
    if ((e.market || market) === 'x') {
      renderXBlocks(body, e);
      body.appendChild(buildReplyTool(e.id));
      return;
    }
    const badge = d.score ? `Quality ${d.score}/100${d.rewritten ? ' (auto-improved)' : ''}` : '';
    body.appendChild(block('LinkedIn post', `<pre>${esc(d.linkedin || '')}</pre>`, d.linkedin, badge));
    body.appendChild(block('X post', `<pre>${esc(d.x || '')}</pre>`, d.x));
    if (d.hooks?.length) body.appendChild(block('Alternative hooks', `<ul>${d.hooks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`, d.hooks.join('\n')));
    if (d.comments?.length) body.appendChild(block('Comments you can leave elsewhere', `<ul>${d.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`, d.comments.join('\n')));
    if (d.bestPostingTime) body.appendChild(block('Best posting time', `<pre>${esc(d.bestPostingTime)}</pre>`));
    if (d.hashtags?.length) body.appendChild(block('Hashtags (for reach)', `<pre>${esc(d.hashtags.join(' '))}</pre>`, d.hashtags.join(' ')));
    body.appendChild(buildReplyTool(e.id));
    if (e.idea?.sources?.length) {
      body.appendChild(block('Sources', `<ul>${e.idea.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul>`));
    }
  });
  return details;
}

// Reply helper: paste a comment, get a short professional reply.
function buildReplyTool(entryId) {
  const div = document.createElement('div');
  div.className = 'block reply-tool';
  div.innerHTML = '<div class="block-head"><h3>Reply to a comment</h3></div><p class="hint">Paste a comment someone left, and get a short, human reply. Click again for a different one.</p>';
  const input = document.createElement('textarea');
  input.rows = 2;
  input.placeholder = 'Paste the comment here...';
  const btn = document.createElement('button');
  btn.textContent = 'Generate reply';
  let generatedOnce = false;
  const out = document.createElement('div');
  out.className = 'reply-out hidden';

  btn.addEventListener('click', async () => {
    const comment = input.value.trim();
    if (!comment) { input.focus(); return; }
    btn.disabled = true;
    btn.textContent = generatedOnce ? 'Writing another...' : 'Writing reply...';
    out.classList.add('hidden');
    try {
      const r = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market, entryId, comment }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not generate a reply.');
      out.innerHTML = '';
      if (data.answer) out.appendChild(block('Reply — answering', `<pre>${esc(data.answer)}</pre>`, data.answer));
      if (data.agree) out.appendChild(block('Reply — quick agreement', `<pre>${esc(data.agree)}</pre>`, data.agree));
      out.classList.remove('hidden');
      generatedOnce = true;
    } catch (e) {
      out.innerHTML = `<p class="hint" style="color:#a33">${esc(e.message)}</p>`;
      out.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = generatedOnce ? 'Generate another reply' : 'Generate reply';
    }
  });

  div.appendChild(input);
  div.appendChild(btn);
  div.appendChild(out);
  return div;
}

async function loadHistory() {
  const r = await fetch(withMarket('/api/history'));
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
        await fetch(withMarket(`/api/history/${e.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market, status: 'posted' }) });
        loadHistory();
      });
      row.appendChild(btn);
    } else {
      // Metric names differ per platform.
      (MARKET_INFO[market]?.metrics || []).forEach((k) => {
        const label = document.createElement('label');
        label.textContent = k;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.placeholder = '0';
        if (m[k] != null) input.value = m[k];
        input.addEventListener('change', async () => {
          await fetch(withMarket(`/api/history/${e.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market, metrics: { [k]: Number(input.value) } }) });
        });
        row.appendChild(label);
        row.appendChild(input);
      });
      // On X, WHO engaged matters more than how many — and no analytics tool shows it.
      if (isX()) {
        const who = document.createElement('input');
        who.type = 'text';
        who.className = 'who-engaged';
        who.placeholder = 'who engaged? (founders, investors, AI builders...)';
        if (e.notes) who.value = e.notes;
        who.addEventListener('change', async () => {
          await fetch(withMarket(`/api/history/${e.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market, notes: who.value }) });
        });
        row.appendChild(who);
      }
    }
    const del = document.createElement('button');
    del.className = 'ghost delete';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${e.topic}"? This cannot be undone.`)) return;
      await fetch(withMarket(`/api/history/${e.id}`), { method: 'DELETE' });
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
    const r = await fetch(withMarket('/api/settings'));
    $('brand-rules').value = (await r.json()).brandRules;
    show(body);
  } else {
    hide(body);
  }
});

$('btn-save-settings').addEventListener('click', async () => {
  const r = await fetch(withMarket('/api/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandRules: $('brand-rules').value }),
  });
  $('settings-status').textContent = r.ok ? 'Saved ✓' : 'Could not save — rules cannot be empty.';
  setTimeout(() => ($('settings-status').textContent = ''), 2500);
});

$('btn-reset-settings').addEventListener('click', async () => {
  const r = await fetch(withMarket('/api/settings/reset'), { method: 'POST' });
  $('brand-rules').value = (await r.json()).brandRules;
  $('settings-status').textContent = 'Reset to default ✓';
  setTimeout(() => ($('settings-status').textContent = ''), 2500);
});

// ---------- util ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- boot ----------
// Reopen whichever market you were last in; otherwise show the chooser.

const savedMarket = localStorage.getItem('pbos_market');
if (MARKET_INFO[savedMarket]) enterMarket(savedMarket);
else leaveMarket();
