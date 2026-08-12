// AI engines. The app talks to whichever one you have installed and signed in,
// so it isn't tied to a single provider and never needs an API key.
//
// Each engine exposes:
//   detect() -> { available, note }   can we use it right now?
//   run({ prompt, allowWebSearch, onProgress }) -> Promise<string>
//
// VERIFIED: claude (built and tested against a real install).
// UNTESTED: the others are written to each tool's documented non-interactive
// interface but were not installed on the machine this was built on. If one
// misbehaves, the fix is almost always the argument list in its runner below.

import { spawn, execFileSync } from 'child_process';

// Run a command, feeding the prompt on stdin so long prompts don't hit the
// shell's argument-length limit. Returns stdout.
function runCommand(cmd, args, prompt, onProgress, label) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error(`could not start ${cmd}: ${e.message}`));
    }
    let out = '';
    let err = '';
    const tick = setInterval(() => onProgress?.(`${label} is working...`), 8000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearInterval(tick); reject(new Error(`could not start ${cmd}: ${e.message}`)); });
    child.on('close', (code) => {
      clearInterval(tick);
      if (code !== 0) {
        return reject(new Error(`${label} failed (exit ${code}). ${err.slice(0, 300)}`));
      }
      resolve(out);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function onPath(cmd) {
  try {
    return Boolean(String(execFileSync('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] })).trim());
  } catch {
    return false; // `which` exits non-zero when the command isn't installed
  }
}

async function serverUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// ---------- Claude Code (verified) ----------

const claudeEngine = {
  id: 'claude',
  label: 'Claude Code',
  webSearch: true,
  detect: () => ({
    available: onPath('claude'),
    note: onPath('claude')
      ? 'Installed. Best results — it can search the web to research and fact-check.'
      : 'Not found. Install with: npm install -g @anthropic-ai/claude-code, then run "claude" once to sign in.',
  }),
  async run({ prompt, allowWebSearch, onProgress }) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    let text = '';
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
            onProgress?.(`Researching: ${String(block.input?.query || block.input?.url || '').slice(0, 80)}`);
          } else if (block.type === 'text') {
            onProgress?.('Thinking...');
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype !== 'success') {
          throw new Error(message.subtype === 'error_max_turns' ? 'research ran too long' : 'Claude returned an error');
        }
        text = message.result || '';
      }
    }
    return text;
  },
};

// ---------- OpenAI Codex (untested) ----------

const codexEngine = {
  id: 'codex',
  label: 'Codex (ChatGPT)',
  webSearch: true,
  detect: () => ({
    available: onPath('codex'),
    note: onPath('codex')
      ? 'Installed. Uses your ChatGPT sign-in.'
      : 'Not found. Install with: npm install -g @openai/codex, then run "codex" once to sign in.',
  }),
  run: ({ prompt, onProgress }) =>
    runCommand('codex', ['exec', '--skip-git-repo-check', '-'], prompt, onProgress, 'Codex'),
};

// ---------- Google Gemini CLI (untested) ----------

const geminiEngine = {
  id: 'gemini',
  label: 'Gemini CLI',
  webSearch: true,
  detect: () => ({
    available: onPath('gemini'),
    note: onPath('gemini')
      ? 'Installed. Uses your Google sign-in and can search the web.'
      : 'Not found. Install with: npm install -g @google/gemini-cli, then run "gemini" once to sign in.',
  }),
  run: ({ prompt, onProgress }) =>
    runCommand('gemini', [], prompt, onProgress, 'Gemini'),
};

// ---------- Ollama, local models (untested) ----------

const ollamaEngine = {
  id: 'ollama',
  label: 'Ollama (runs on your Mac)',
  webSearch: false,
  model: 'llama3.2',
  detect: () => ({
    available: onPath('ollama'),
    note: onPath('ollama')
      ? 'Installed. Free and works offline, but it CANNOT search the web — ideas will come from what the model already knows, and facts are not checked.'
      : 'Not found. Install from ollama.com, then run: ollama pull llama3.2',
  }),
  run: ({ prompt, onProgress }) =>
    runCommand('ollama', ['run', ollamaEngine.model], prompt, onProgress, 'Ollama'),
};

// ---------- LM Studio, local server (untested) ----------

const lmStudioEngine = {
  id: 'lmstudio',
  label: 'LM Studio (runs on your Mac)',
  webSearch: false,
  detect: () => ({
    available: false, // replaced at runtime by detectEngines()
    note: 'Start LM Studio and turn on its local server (port 1234).',
  }),
  async run({ prompt, onProgress }) {
    onProgress?.('LM Studio is working...');
    const r = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.7 }),
    });
    if (!r.ok) throw new Error(`LM Studio returned ${r.status}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || '';
  },
};

export const ENGINES = [claudeEngine, codexEngine, geminiEngine, ollamaEngine, lmStudioEngine];
export const ENGINE_IDS = ENGINES.map((e) => e.id);

export function getEngine(id) {
  return ENGINES.find((e) => e.id === id) || claudeEngine;
}

// What can this machine actually use right now?
export async function detectEngines() {
  const lmUp = await serverUp('http://localhost:1234/v1/models');
  return ENGINES.map((e) => {
    const d = e.id === 'lmstudio'
      ? { available: lmUp, note: lmUp ? 'Running. Cannot search the web, so facts are not checked.' : e.detect().note }
      : e.detect();
    return { id: e.id, label: e.label, webSearch: e.webSearch, ...d };
  });
}

// Prefer whatever is installed, best first, when nothing has been chosen.
export async function pickDefaultEngine() {
  const found = await detectEngines();
  return (found.find((e) => e.available) || { id: 'claude' }).id;
}
