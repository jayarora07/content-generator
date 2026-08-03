import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  DEFAULT_RULES, MARKETS,
  buildIdeasPrompt, buildPostsPrompt, buildReplyPrompt,
  buildXIdeasPrompt, buildXPostPrompt, buildReactPrompt,
} from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3999;
const MOCK = process.env.MOCK_CLAUDE === '1';

// ---------- JSON file storage (partitioned per market) ----------

// Only ever accept a known market — this value becomes part of a file path.
function safeMarket(value) {
  return MARKETS.includes(value) ? value : null;
}

for (const m of MARKETS) fs.mkdirSync(path.join(DATA_DIR, m), { recursive: true });

// One-time migration: the app used to be India-only with files sitting directly
// in data/. Move them into data/india/ so nothing is lost.
(function migrateLegacyData() {
  for (const name of ['content_history.json', 'settings.json']) {
    const legacy = path.join(DATA_DIR, name);
    const target = path.join(DATA_DIR, 'india', name);
    if (fs.existsSync(legacy) && !fs.existsSync(target)) {
      fs.copyFileSync(legacy, target);
      fs.renameSync(legacy, legacy + '.migrated');
      if (fs.existsSync(legacy + '.bak')) {
        fs.copyFileSync(legacy + '.bak', target + '.bak');
      }
      console.log(`Migrated ${name} -> data/india/${name}`);
    }
  }
  // Saved rules from before the market split have no MARKET FOCUS section, so they
  // would leave the writer with no length / posting-time / hashtag instructions.
  // Upgrade them to this market's defaults (the previous file is kept as .bak).
  for (const m of MARKETS) {
    const file = path.join(DATA_DIR, m, 'settings.json');
    if (!fs.existsSync(file)) continue;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!String(saved.brandRules || '').includes('MARKET FOCUS')) {
        const tmp = file + '.tmp';
        fs.copyFileSync(file, file + '.bak');
        fs.writeFileSync(tmp, JSON.stringify({ brandRules: DEFAULT_RULES[m] }, null, 2));
        fs.renameSync(tmp, file);
        console.log(`Upgraded ${m} settings to the new market-aware rules`);
      }
    } catch {
      /* unreadable settings just fall back to defaults on read */
    }
  }
})();

function readJson(market, name, fallback) {
  const file = path.join(DATA_DIR, market, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(market, name, value) {
  const file = path.join(DATA_DIR, market, name);
  const tmp = file + '.tmp';
  // keep a backup of the previous version so history is never silently lost
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const history = (market) => readJson(market, 'content_history.json', { entries: [] });

// Build a taste profile from what the user actually posted (not just drafted).
// Engagement metrics, when logged, promote a post to "top performer".
function buildTasteProfile(h, market) {
  const posted = h.entries.filter((e) => e.status === 'posted').slice(-30);
  if (posted.length < 2) return ''; // not enough signal yet
  const isX = market === 'x';
  const lines = [];

  const catCounts = {};
  for (const e of posted) catCounts[e.category] = (catCounts[e.category] || 0) + 1;
  lines.push(`Categories actually posted: ${Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}`);

  lines.push('Topics the author chose to post:');
  for (const e of posted.slice(-10)) lines.push(`- ${e.topic}`);

  // LinkedIn is judged on reach; X is judged on whether people argued back,
  // which is what the ranker rewards and what separates respect from applause.
  const score = (m = {}) => (isX
    ? 5 * (m.replies || 0) + 3 * (m.reposts || 0) + (m.likes || 0)
    : (m.impressions || 0));
  const withMetrics = posted
    .map((e) => ({ e, s: score(e.metrics), eng: (e.metrics?.likes || 0) + 3 * (e.metrics?.comments || 0) }))
    .filter((x) => x.s > 0 || x.eng > 0)
    .sort((a, b) => b.s - a.s || b.eng - a.eng);

  if (withMetrics.length) {
    lines.push(isX
      ? 'TOP-PERFORMING POSTS — these earned the most REPLIES and REPOSTS, i.e. people had something to say back. Match this calibre of specificity and arguability:'
      : 'TOP-PERFORMING POSTS — these got the most REACH. Study them and match this exact style, specificity, and angle. Aim for the same calibre:');
    for (const { e } of withMetrics.slice(0, 5)) {
      const m = e.metrics || {};
      const first = (isX ? (e.drafts?.post || '') : (e.drafts?.linkedin || '')).split('\n')[0];
      const bits = (isX
        ? [m.views ? `${m.views.toLocaleString('en-US')} views` : '', m.replies ? `${m.replies} replies` : '', m.reposts ? `${m.reposts} reposts` : '', m.likes ? `${m.likes} likes` : '']
        : [m.impressions ? `${m.impressions.toLocaleString('en-US')} impressions` : '', m.likes ? `${m.likes} likes` : '', m.comments ? `${m.comments} comments` : '']
      ).filter(Boolean).join(', ');
      const who = isX && e.notes ? ` — engaged by: ${e.notes}` : '';
      lines.push(`- "${e.topic}"${bits ? ` (${bits})` : ''}${first ? ` — opened: "${first}"` : ''}${who}`);
    }
  }
  return lines.join('\n');
}
const settings = (market) =>
  readJson(market, 'settings.json', { brandRules: DEFAULT_RULES[market] });

// ---------- Claude wrapper ----------

const mockIdeas = (market) => ({
  ideas: Array.from({ length: market === 'x' ? 10 : 8 }, (_, i) => ({
    topic:
      market === 'x'
        ? `Mock X idea ${i + 1}: the detail everyone missed in yesterday's model release`
        : market === 'global'
          ? `Mock global idea ${i + 1}: a small Notion default worth noticing`
          : `Mock India idea ${i + 1}: a small Swiggy default worth noticing`,
    category: market === 'x'
      ? ['ai-launch', 'product-launch', 'product-insight', 'founder-observation', 'prediction'][i % 5]
      : ['ai-products', 'product-thinking', 'user-research', 'startup-execution', 'other'][i % 5],
    whyItMatters: 'This is fixture data for testing the UI without calling Claude.',
    newsDate: '2 days ago',
    timeliness: 8,
    scores: { originality: 8, engagement: 7, brandAlignment: 9, longTermValue: 8 },
    sources: [{ title: 'Hacker News', url: 'https://news.ycombinator.com' }],
  })),
});

const MOCK_X_POST = {
  post: 'Mock X post for testing.\n\nOne idea, no hashtags, no emoji — roughly 90-150 words in a real run.',
  mode: 'take',
  receipt: 'Screenshot of the pricing table on the announcement page (the per-token row).',
  hooks: ['Mock X hook one.', 'Mock X hook two.', 'Mock X hook three.'],
  followUp: 'Mock one-line follow-up if this takes off.',
  replies: ['R1', 'R2', 'R3', 'R4', 'R5'],
  linkPlan: 'none',
  sources: [{ title: 'Hacker News', url: 'https://news.ycombinator.com' }],
  timeliness: 8,
  postWithin: 'next 3 hours',
};

const mockPosts = (market) =>
  market === 'x'
    ? MOCK_X_POST
    : market === 'global'
    ? {
        linkedin:
          'Mock global draft for testing.\n\nRuns longer than the India format — roughly 220-340 words in a real run.',
        x: 'Mock global X post for testing.',
        hooks: ['Mock global hook one.', 'Mock global hook two.', 'Mock global hook three.'],
        comments: ['C1', 'C2', 'C3', 'C4', 'C5'],
        bestPostingTime: 'Wednesday 9:00 AM ET (2:00 PM UK)',
        hashtags: ['#ProductManagement', '#ProductThinking', '#UX', '#ProductDesign'],
        score: 88,
        scoreBreakdown: { originality: 88, authority: 90, clarity: 92, discussionPotential: 85, shareability: 84, longTermBrandValue: 89 },
        rewritten: false,
      }
    : {
        linkedin:
          'Mock India draft for testing.\n\nShort and punchy — roughly 100-160 words in a real run.',
        x: 'Mock India X post for testing.',
        hooks: ['Mock India hook one.', 'Mock India hook two.', 'Mock India hook three.'],
        comments: ['C1', 'C2', 'C3', 'C4', 'C5'],
        bestPostingTime: 'Tuesday 9:00 AM IST',
        hashtags: ['#ProductManagement', '#ProductThinking', '#UX', '#BuildingForBharat'],
        score: 88,
        scoreBreakdown: { originality: 88, authority: 90, clarity: 92, discussionPotential: 85, shareability: 84, longTermBrandValue: 89 },
        rewritten: false,
      };

const MOCK_REPLY = { answer: 'Honestly the timing helped, but the core idea still holds if the reward is real.', agree: 'Yeah, exactly this.' };

function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object found in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function runClaude(prompt, { allowWebSearch = false, onProgress = () => {}, mockResult } = {}) {
  if (MOCK) {
    onProgress('Using mock data (MOCK_CLAUDE=1)...');
    await new Promise((r) => setTimeout(r, 1500));
    return mockResult;
  }
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let resultText = '';
  const q = query({
    prompt,
    options: {
      allowedTools: allowWebSearch ? ['WebSearch', 'WebFetch'] : [],
      permissionMode: 'bypassPermissions',
      maxTurns: 30,
    },
  });
  for await (const message of q) {
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if (block.type === 'tool_use' && (block.name === 'WebSearch' || block.name === 'WebFetch')) {
          const target = block.input?.query || block.input?.url || '';
          onProgress(`Researching: ${String(target).slice(0, 80)}`);
        } else if (block.type === 'text') {
          onProgress('Thinking...');
        }
      }
    } else if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(message.subtype === 'error_max_turns' ? 'research ran too long' : 'Claude returned an error');
      }
      resultText = message.result || '';
    }
  }
  return extractJson(resultText);
}

function friendlyError(err) {
  if (err?.friendly) return err.friendly;
  const msg = String(err?.message || err);
  if (/ENOENT|not found|command.*claude/i.test(msg)) {
    return 'Claude Code was not found on this computer. Fix: open Terminal, run "npm install -g @anthropic-ai/claude-code", then run "claude" once and sign in.';
  }
  if (/auth|login|credential|oauth|session expired|401|unauthorized/i.test(msg)) {
    return 'Your Claude login has expired. Fix: open Terminal, type "claude", press Enter, and sign in again. Then come back and retry — nothing here is lost.';
  }
  // The SDK reports an expired login only as a bare non-zero exit, so name the
  // most likely cause rather than showing a meaningless code.
  if (/exited with code|process (?:failed|exited)/i.test(msg)) {
    return 'Claude couldn\'t start — usually this means your login has expired. Fix: open Terminal, type "claude", press Enter, and sign in again. Then retry here.';
  }
  if (/JSON|parse/i.test(msg)) {
    return 'Claude replied in an unexpected format. This happens occasionally — just click the button again.';
  }
  if (/too long|timeout|max_turns/i.test(msg)) {
    return 'The research took too long this time. Just try again — it usually works on the second attempt.';
  }
  return `Something went wrong (${msg}). Try again; if it keeps happening, restart the app.`;
}

// ---------- SSE job handling ----------
// One generation at a time; the client opens an SSE stream and gets progress + final result.

let activeJob = null;

function sseHandler(buildPromptAndRun) {
  return async (req, res) => {
    const market = safeMarket(req.query.market);
    if (!market) {
      res.status(400).json({ error: 'Pick a market first (Indian or Global).' });
      return;
    }
    if (activeJob) {
      res.status(409).json({ error: 'A generation is already running. Wait for it to finish, then try again.' });
      return;
    }
    activeJob = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    try {
      const result = await buildPromptAndRun((msg) => send('progress', { message: msg }), market);
      send('done', result);
    } catch (err) {
      send('failed', { error: friendlyError(err) });
    } finally {
      clearInterval(heartbeat);
      activeJob = null;
      res.end();
    }
  };
}

// ---------- App ----------

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Step 1: research ideas (SSE via GET so EventSource works directly)
app.get('/api/ideas', sseHandler(async (onProgress, market) => {
  onProgress('Reading your post history...');
  const h = history(market);
  const recentTopics = h.entries.slice(-20).map((e) => e.topic);
  const taste = buildTasteProfile(h, market);

  if (market === 'x') {
    onProgress('Scanning AI launches, changelogs, HN, r/LocalLLaMA...');
    const today = new Date().toISOString().slice(0, 10);
    const prompt = buildXIdeasPrompt(settings(market).brandRules, recentTopics, taste, today);
    const result = await runClaude(prompt, { allowWebSearch: true, onProgress, mockResult: mockIdeas(market) });
    if (!Array.isArray(result?.ideas) || result.ideas.length === 0) throw new Error('JSON missing ideas');
    return { ideas: result.ideas, generatedAt: new Date().toISOString() };
  }

  const counts = {};
  for (const e of h.entries.slice(-20)) counts[e.category] = (counts[e.category] || 0) + 1;
  const countsStr = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
  onProgress('Starting research across HN, Reddit, X, Product Hunt, tech blogs...');
  const prompt = buildIdeasPrompt(settings(market).brandRules, recentTopics, countsStr, taste);
  const result = await runClaude(prompt, { allowWebSearch: true, onProgress, mockResult: mockIdeas(market) });
  if (!Array.isArray(result?.ideas) || result.ideas.length === 0) throw new Error('JSON missing ideas');
  return { ideas: result.ideas, generatedAt: new Date().toISOString() };
}));

// Step 2: write posts for the chosen idea.
// The client first POSTs the idea to /api/posts/start, then opens the SSE stream.
let pendingIdea = null;

app.post('/api/posts/start', (req, res) => {
  const market = safeMarket(req.body?.market);
  if (!market) return res.status(400).json({ error: 'Pick a market first.' });
  const idea = req.body?.idea;
  if (!idea?.topic) return res.status(400).json({ error: 'No idea selected.' });
  // stash the idea (and any first-hand note) for the SSE call that follows
  pendingIdea = { market, idea, observation: (req.body?.observation || '').trim() };
  res.json({ ok: true });
});

// Reject a draft when the model couldn't verify the central claim — including the
// case where it writes its verification notes into the post body instead.
function guardUnverified(result, bodyText) {
  const looksLikeReport = /UNABLE TO VERIFY|cannot be (?:confirmed|verified)|accuracy requirement|RECOMMEND:/i.test(bodyText || '');
  if (result?.unverified || looksLikeReport) {
    const e = new Error('unverified');
    e.friendly = `Couldn't confirm the key fact behind this, so I didn't write it up: ${result.reason || 'the main claim could not be verified from reliable sources.'} Pick a different idea — the others are fine.`;
    throw e;
  }
}

function saveEntry(market, { topic, category, idea, drafts }) {
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    market,
    topic,
    category,
    idea,
    drafts,
    status: 'draft',
    metrics: {},
    notes: '',
  };
  const h = history(market);
  h.entries.push(entry);
  writeJson(market, 'content_history.json', h);
  return entry;
}

app.get('/api/posts/stream', sseHandler(async (onProgress, market) => {
  const pending = pendingIdea;
  pendingIdea = null;
  if (!pending?.idea) throw new Error('missing idea');
  if (pending.market !== market) throw new Error('missing idea');
  const idea = pending.idea;
  const h = history(market);
  const taste = buildTasteProfile(h, market);

  if (market === 'x') {
    onProgress(`Checking the facts on: ${idea.topic}`);
    const recentOpenings = h.entries.slice(-5).map((e) => (e.drafts?.post || '').split('\n')[0]).filter(Boolean);
    const prompt = buildXPostPrompt(settings(market).brandRules, idea, recentOpenings, taste, pending.observation);
    const result = await runClaude(prompt, { allowWebSearch: true, onProgress, mockResult: mockPosts(market) });
    guardUnverified(result, result?.post);
    if (!result?.post) throw new Error('JSON missing post');
    return { entry: saveEntry(market, { topic: idea.topic, category: idea.category, idea, drafts: result }) };
  }

  onProgress(`Checking facts and writing posts for: ${idea.topic}`);
  const recentHooks = h.entries.slice(-5).map((e) => (e.drafts?.linkedin || '').split('\n')[0]).filter(Boolean);
  const prompt = buildPostsPrompt(settings(market).brandRules, idea, recentHooks, taste);
  const result = await runClaude(prompt, { allowWebSearch: true, onProgress, mockResult: mockPosts(market) });
  guardUnverified(result, result?.linkedin);
  if (!result?.linkedin || !result?.x) throw new Error('JSON missing drafts');
  return { entry: saveEntry(market, { topic: idea.topic, category: idea.category, idea, drafts: result }) };
}));

// X fast path: paste something you just saw, get a take.
app.post('/api/react', async (req, res) => {
  if (activeJob) return res.status(409).json({ error: 'Something is already generating. Wait a moment, then try again.' });
  const market = safeMarket(req.body?.market);
  if (market !== 'x') return res.status(400).json({ error: 'Quick takes are only for the X market.' });
  const input = (req.body?.input || '').trim();
  if (!input) return res.status(400).json({ error: 'Paste a link or headline first.' });
  const observation = (req.body?.observation || '').trim();

  activeJob = true;
  try {
    const h = history(market);
    const prompt = buildReactPrompt(settings(market).brandRules, input, observation, buildTasteProfile(h, market));
    const result = await runClaude(prompt, { allowWebSearch: true, mockResult: mockPosts(market) });
    guardUnverified(result, result?.post);
    if (!result?.post) throw new Error('JSON missing post');
    const topic = input.length > 80 ? input.slice(0, 77) + '...' : input;
    res.json({ entry: saveEntry(market, { topic, category: 'ai-launch', idea: { topic, sources: result.sources || [] }, drafts: result }) });
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  } finally {
    activeJob = false;
  }
});

// Generate a short professional reply to a comment on a posted piece.
app.post('/api/reply', async (req, res) => {
  if (activeJob) return res.status(409).json({ error: 'Something is already generating. Wait a moment, then try again.' });
  const market = safeMarket(req.body?.market);
  if (!market) return res.status(400).json({ error: 'Pick a market first (Indian or Global).' });
  const { entryId, comment } = req.body || {};
  if (!comment || !comment.trim()) return res.status(400).json({ error: 'Please type the comment you want to reply to.' });
  const entry = history(market).entries.find((e) => e.id === entryId);
  const postText = entry?.drafts?.linkedin || '';
  // Reply under the rules the post itself was written with.
  const rulesMarket = safeMarket(entry?.market) || market;

  // Rotate a style nudge so repeated clicks produce genuinely different replies.
  const VARIANTS = [
    'keep it warm and appreciative',
    'reply with a short, curious question back',
    'agree and add one quick fresh thought',
    'be light and a little playful',
    'be crisp and matter-of-fact',
    'gently offer a slightly different angle',
  ];
  const variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];

  activeJob = true;
  try {
    const prompt = buildReplyPrompt(settings(rulesMarket).brandRules, postText, comment.trim(), variant);
    const result = await runClaude(prompt, { mockResult: MOCK_REPLY });
    if (!result?.answer && !result?.agree) throw new Error('no reply generated');
    res.json({ answer: result.answer || '', agree: result.agree || '' });
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  } finally {
    activeJob = false;
  }
});

// Reject any request that didn't name a valid market.
function requireMarket(req, res) {
  const market = safeMarket(req.query.market ?? req.body?.market);
  if (!market) {
    res.status(400).json({ error: 'Pick a market first (Indian or Global).' });
    return null;
  }
  return market;
}

// History
app.get('/api/history', (req, res) => {
  const market = requireMarket(req, res);
  if (market) res.json(history(market));
});

app.patch('/api/history/:id', (req, res) => {
  const market = requireMarket(req, res);
  if (!market) return;
  const h = history(market);
  const entry = h.entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Post not found.' });
  const { status, metrics, notes } = req.body || {};
  if (status) {
    entry.status = status;
    if (status === 'posted' && !entry.postedAt) entry.postedAt = new Date().toISOString();
  }
  if (metrics) entry.metrics = { ...entry.metrics, ...metrics };
  if (notes !== undefined) entry.notes = notes;
  writeJson(market, 'content_history.json', h);
  res.json(entry);
});

app.delete('/api/history/:id', (req, res) => {
  const market = requireMarket(req, res);
  if (!market) return;
  const h = history(market);
  const idx = h.entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found.' });
  h.entries.splice(idx, 1);
  writeJson(market, 'content_history.json', h);
  res.json({ ok: true });
});

// Settings — each market has its own independently editable rules.
app.get('/api/settings', (req, res) => {
  const market = requireMarket(req, res);
  if (market) res.json(settings(market));
});
app.put('/api/settings', (req, res) => {
  const market = requireMarket(req, res);
  if (!market) return;
  const brandRules = req.body?.brandRules;
  if (typeof brandRules !== 'string' || !brandRules.trim()) {
    return res.status(400).json({ error: 'Brand rules cannot be empty.' });
  }
  writeJson(market, 'settings.json', { brandRules });
  res.json({ ok: true });
});
app.post('/api/settings/reset', (req, res) => {
  const market = requireMarket(req, res);
  if (!market) return;
  writeJson(market, 'settings.json', { brandRules: DEFAULT_RULES[market] });
  res.json({ brandRules: DEFAULT_RULES[market] });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Personal Brand OS running at http://localhost:${PORT}${MOCK ? ' (MOCK MODE)' : ''}`);
});
