import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DEFAULT_BRAND_RULES, buildIdeasPrompt, buildPostsPrompt } from './prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 3999;
const MOCK = process.env.MOCK_CLAUDE === '1';

// ---------- JSON file storage ----------

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  const file = path.join(DATA_DIR, name);
  const tmp = file + '.tmp';
  // keep a backup of the previous version so history is never silently lost
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const history = () => readJson('content_history.json', { entries: [] });

// Build a taste profile from what the user actually posted (not just drafted).
// Engagement metrics, when logged, promote a post to "top performer".
function buildTasteProfile(h) {
  const posted = h.entries.filter((e) => e.status === 'posted').slice(-30);
  if (posted.length < 2) return ''; // not enough signal yet
  const lines = [];

  const catCounts = {};
  for (const e of posted) catCounts[e.category] = (catCounts[e.category] || 0) + 1;
  lines.push(`Categories actually posted: ${Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}`);

  lines.push('Topics the author chose to post:');
  for (const e of posted.slice(-10)) lines.push(`- ${e.topic}`);

  const withMetrics = posted
    .map((e) => ({ e, score: (e.metrics?.likes || 0) + 3 * (e.metrics?.comments || 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (withMetrics.length) {
    lines.push('Best-performing posts (highest engagement — lean toward this style):');
    for (const { e } of withMetrics.slice(0, 5)) {
      const firstLine = (e.drafts?.linkedin || '').split('\n')[0];
      lines.push(`- "${e.topic}" (likes: ${e.metrics?.likes || 0}, comments: ${e.metrics?.comments || 0})${firstLine ? ` — opened with: "${firstLine}"` : ''}`);
    }
  }
  return lines.join('\n');
}
const settings = () => readJson('settings.json', { brandRules: DEFAULT_BRAND_RULES });

// ---------- Claude wrapper ----------

const MOCK_IDEAS = {
  ideas: Array.from({ length: 5 }, (_, i) => ({
    topic: `Mock idea ${i + 1}: why AI product evals matter`,
    category: ['ai-products', 'product-thinking', 'user-research', 'startup-execution', 'other'][i],
    whyItMatters: 'This is fixture data for testing the UI without calling Claude.',
    scores: { originality: 8, engagement: 7, brandAlignment: 9, longTermValue: 8 },
    sources: [{ title: 'Hacker News', url: 'https://news.ycombinator.com' }],
  })),
};

const MOCK_POSTS = {
  linkedin: 'Most teams treat AI evals as a launch checklist item.\n\nThe better framing: evals are your product spec. (Mock draft for testing — about 200 words in a real run.)',
  x: 'Your AI eval suite is your real product spec. Everything else is commentary.',
  hooks: ['Most teams get evals backwards.', 'Your eval suite is your product spec.', 'Stop treating evals as QA.'],
  comments: ['Great point about X.', 'This matches what I have seen with Y.', 'One nuance to add...', 'How does this apply to Z?', 'The second-order effect here is interesting.'],
  bestPostingTime: 'Tuesday 9:00 AM IST',
  score: 88,
  scoreBreakdown: { originality: 88, authority: 90, clarity: 92, discussionPotential: 85, shareability: 84, longTermBrandValue: 89 },
  rewritten: false,
};

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
  const msg = String(err?.message || err);
  if (/ENOENT|not found|command.*claude/i.test(msg)) {
    return 'Claude Code was not found on this computer. Fix: open Terminal, run "npm install -g @anthropic-ai/claude-code", then run "claude" once and sign in.';
  }
  if (/auth|login|credential|401|unauthorized/i.test(msg)) {
    return 'Claude is not signed in. Fix: open Terminal, type "claude", and log in once. Then try again here.';
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
      const result = await buildPromptAndRun((msg) => send('progress', { message: msg }));
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
app.get('/api/ideas', sseHandler(async (onProgress) => {
  onProgress('Reading your post history...');
  const h = history();
  const recentTopics = h.entries.slice(-20).map((e) => e.topic);
  const counts = {};
  for (const e of h.entries.slice(-20)) counts[e.category] = (counts[e.category] || 0) + 1;
  const countsStr = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
  onProgress('Starting research across HN, Reddit, X, Product Hunt, tech blogs...');
  const prompt = buildIdeasPrompt(settings().brandRules, recentTopics, countsStr, buildTasteProfile(h));
  const result = await runClaude(prompt, { allowWebSearch: true, onProgress, mockResult: MOCK_IDEAS });
  if (!Array.isArray(result?.ideas) || result.ideas.length === 0) throw new Error('JSON missing ideas');
  return result;
}));

// Step 2: write posts for the chosen idea.
// The client first POSTs the idea to /api/posts/start, then opens the SSE stream.
let pendingIdea = null;

app.post('/api/posts/start', (req, res) => {
  // stash the idea for the SSE call that follows
  pendingIdea = req.body?.idea;
  if (!pendingIdea?.topic) return res.status(400).json({ error: 'No idea selected.' });
  res.json({ ok: true });
});

app.get('/api/posts/stream', sseHandler(async (onProgress) => {
  const idea = pendingIdea;
  pendingIdea = null;
  if (!idea) throw new Error('missing idea');
  onProgress(`Writing posts for: ${idea.topic}`);
  const h = history();
  const recentHooks = h.entries.slice(-5).map((e) => (e.drafts?.linkedin || '').split('\n')[0]).filter(Boolean);
  const prompt = buildPostsPrompt(settings().brandRules, idea, recentHooks, buildTasteProfile(h));
  const result = await runClaude(prompt, { allowWebSearch: false, onProgress, mockResult: MOCK_POSTS });
  if (!result?.linkedin || !result?.x) throw new Error('JSON missing drafts');

  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    topic: idea.topic,
    category: idea.category,
    idea,
    drafts: result,
    status: 'draft',
    metrics: {},
    notes: '',
  };
  const hh = history();
  hh.entries.push(entry);
  writeJson('content_history.json', hh);
  return { entry };
}));

// History
app.get('/api/history', (req, res) => res.json(history()));

app.patch('/api/history/:id', (req, res) => {
  const h = history();
  const entry = h.entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Post not found.' });
  const { status, metrics, notes } = req.body || {};
  if (status) {
    entry.status = status;
    if (status === 'posted' && !entry.postedAt) entry.postedAt = new Date().toISOString();
  }
  if (metrics) entry.metrics = { ...entry.metrics, ...metrics };
  if (notes !== undefined) entry.notes = notes;
  writeJson('content_history.json', h);
  res.json(entry);
});

app.delete('/api/history/:id', (req, res) => {
  const h = history();
  const idx = h.entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found.' });
  h.entries.splice(idx, 1);
  writeJson('content_history.json', h);
  res.json({ ok: true });
});

// Settings
app.get('/api/settings', (req, res) => res.json(settings()));
app.put('/api/settings', (req, res) => {
  const brandRules = req.body?.brandRules;
  if (typeof brandRules !== 'string' || !brandRules.trim()) {
    return res.status(400).json({ error: 'Brand rules cannot be empty.' });
  }
  writeJson('settings.json', { brandRules });
  res.json({ ok: true });
});
app.post('/api/settings/reset', (req, res) => {
  writeJson('settings.json', { brandRules: DEFAULT_BRAND_RULES });
  res.json({ brandRules: DEFAULT_BRAND_RULES });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Personal Brand OS running at http://localhost:${PORT}${MOCK ? ' (MOCK MODE)' : ''}`);
});
