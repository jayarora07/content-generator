# Personal Brand OS

A private, local content tool. It researches what's happening, suggests ideas,
writes the posts, and learns which ones actually worked for you.

Everything runs on your own machine. Nothing publishes automatically, and there
are no API keys to manage — it uses whichever AI you're already signed in to.

## Running it on a new machine

```bash
git clone <your-repo-url>
cd content-generator
npm install
npm start
```

Then open **http://localhost:3999**.

On a Mac you can also just double-click `start.command`.

### You need one AI engine installed and signed in

Pick whichever you have. Open **Settings** in the app to choose — it shows you
what it found and how to install the rest.

| Engine | Install | Can search the web? |
|---|---|---|
| **Claude Code** (recommended) | `npm install -g @anthropic-ai/claude-code`, then run `claude` once | Yes |
| Codex (ChatGPT) | `npm install -g @openai/codex`, then run `codex` once | Yes |
| Gemini CLI | `npm install -g @google/gemini-cli`, then run `gemini` once | Yes |
| Ollama | Install from ollama.com, then `ollama pull llama3.2` | No |
| LM Studio | Install it and turn on the local server (port 1234) | No |

Web search matters a lot: it's how the app researches current news and how it
fact-checks a claim before writing. The local options (Ollama, LM Studio) are
free and work offline, but they can only draw on what the model already knows
and they cannot verify anything.

## Your posts come with the repo

`data/` is committed, so cloning this anywhere brings your posts, your settings
and your performance numbers with it. That's what makes the app's
taste-learning work — it studies the posts you marked as posted and the
engagement you logged.

After posting something, come back and record the numbers. That's the loop that
makes suggestions get better over time.

**Keep this repository private.** It contains your unpublished drafts.

## The three markets

Pick one on the home screen. Each keeps entirely separate posts, settings and
history.

- **Indian market** — Indian consumer apps, for PMs and founders in India
- **Global market** — global brands, for a US/UK audience
- **X (Twitter)** — fast, timely takes on AI and tech news

## Day to day

1. Pick a market
2. **Get content ideas** — it researches and returns scored ideas
3. Pick one, **Write this one** — it fact-checks, then writes the post
4. Copy, publish manually
5. **Mark as posted**, and log the numbers a few days later

For X there's also a paste box: drop in a link or headline you just saw and get
a take in about a minute.

## Files

| File | What it is |
|---|---|
| `server.js` | The local web server and all the API routes |
| `prompts.js` | Brand rules and every prompt — edit here to change the writing |
| `engines.js` | The AI engines and how each one is called |
| `public/` | The single-page interface |
| `data/<market>/` | Your posts, settings and shown-ideas history |
