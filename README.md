# Personal Brand OS

Personal Brand OS is a private-by-default, local web application for researching,
drafting, and improving personal-brand content. It is built for one author who
writes about products, AI, user behavior, and product management for three
different audiences:

- India-focused LinkedIn content
- Global (primarily US/UK) LinkedIn content
- Timely posts for X

The application runs on your computer, opens at `http://localhost:3999`, stores
its working data as JSON files in this repository, and uses an AI command-line
tool or local model that is already installed on the machine. There is no
account system, database, cloud backend, API-key screen, scheduler, or automatic
publishing. The final decision to copy and publish a post always belongs to the
author.

## What the application actually does

The core workflow is a feedback loop rather than a one-off text generator:

1. You select an audience/market.
2. The app sends that market's writing rules, recent topics, skipped ideas, and
   learned taste profile to the selected AI engine.
3. With a web-capable engine, the AI researches current products and news and
   returns scored content ideas with sources.
4. You choose an idea. The AI fact-checks its central claim and writes the
   market-specific content package.
5. The app saves the generated package to the selected market's history.
6. You copy and publish it manually.
7. You mark it as posted and enter its performance metrics.
8. Future prompts use the topics you selected and the posts that performed best
   to better match your taste.

This learning is prompt-based and local. There is no trained model or vector
database. The server builds a compact taste profile from the JSON history and
includes it in later AI requests.

## What it generates

### Indian market

The India workflow researches recognizable Indian consumer products across
fintech, commerce, food, travel, health, education, entertainment, public
services, and other sectors. It looks for one small, real product decision and a
non-obvious reason behind it.

A completed generation contains:

- A short LinkedIn post (the default rules target 100–160 words)
- A version for X
- Alternative hooks
- Comments the author can leave on related posts
- A recommended posting time in IST
- Suggested hashtags
- The research sources used to validate the idea
- A quality score returned by the model

### Global market

The global workflow uses products familiar to US and UK readers and favors
specific observations about money, consent, cancellation, regulation, trust,
and less-obvious interaction details.

It returns the same package as the Indian market, but the default rules target a
longer LinkedIn post (220–340 words), US spelling, and an ET posting time with a
UK equivalent.

### X market

The X workflow is intentionally different. It looks for current AI, product, and
technology developments and writes either a very short pointer or a denser take.
The goal is a timely, arguable observation rather than a compressed LinkedIn
post.

A completed X generation can contain:

- The post
- Its mode and word count
- A timeliness score and recommended publishing window
- Exact instructions for a screenshot or other supporting evidence
- Alternative openings
- A follow-up post
- Suggested replies to leave on other posts
- A link-placement recommendation
- Research sources

X also has a fast path: paste a link, headline, or excerpt into **Saw something?
Get a take**, optionally add what you personally noticed, and the app will verify
the subject and draft a response.

## The built-in writing strategy

The detailed editorial system lives in `prompts.js`. It combines shared brand
rules with a separate market block for India, Global, or X. The defaults are
deliberately opinionated:

- Write as a curious product peer, not a guru.
- Focus on one concrete product detail and the trade-off behind it.
- Avoid generic advice, clickbait, preaching, jargon, and recognizable
  AI-writing templates.
- Never imply that the author is building a startup, fundraising, validating an
  idea, or discussing confidential work.
- Do not invent facts. Current product details should be checked before a draft
  is written.
- Keep research citations outside the post copy while retaining them in the UI
  for the author's review.
- Avoid repeating recent topics, companies, and openings.

Each market's complete rules are visible and editable under **Settings → Brand
rules**. Saving there writes the rules to that market's `settings.json`; resetting
restores the defaults currently defined in `prompts.js`.

## How the feedback loop works

The three markets have independent histories and independent rules. The server
uses only entries whose status is `posted` when building a taste profile.

Once at least two posts have been marked as posted, future prompts include:

- The categories the author actually chose
- The topics of the ten most recent posted items
- Up to five top-performing posts and their opening lines
- Recorded engagement context

For India and Global, reach is ranked primarily by impressions, with likes and
comments as supporting signals. For X, replies are weighted most heavily,
followed by reposts and likes. The optional **who engaged?** note for an X post is
also included so the system can distinguish meaningful attention from raw
volume.

Idea repetition is handled separately. Every displayed idea is recorded in
`shown_ideas.json`, even if it is not selected. The app excludes recently shown
ideas from later prompts, keeps at most 120 records per market, and lets records
older than 30 days expire.

## AI engines

Open **Settings → AI engine** to see which engines the app detects. If no engine
has been selected, it chooses the first available option in the order below.

| Engine | How it is used | Web research | Implementation status |
|---|---|---:|---|
| Claude Code | Claude Agent SDK using the existing Claude Code login | Yes | Verified by the original implementation |
| Codex | `codex exec` using the existing ChatGPT login | Yes | Implemented but marked untested in the source |
| Gemini CLI | Non-interactive Gemini CLI process | Yes | Implemented but marked untested in the source |
| Ollama | Local `llama3.2` model | No | Implemented but marked untested in the source |
| LM Studio | OpenAI-compatible local server on port `1234` | No | Implemented but marked untested in the source |

The local options can work without sending prompts to a hosted AI provider, but
they cannot perform the live research this project's accuracy rules expect.
Their ideas come from the model's existing knowledge, so time-sensitive claims
must be reviewed especially carefully.

### Engine setup

Claude Code (recommended and verified):

```bash
npm install -g @anthropic-ai/claude-code
claude
```

Codex:

```bash
npm install -g @openai/codex
codex
```

Gemini CLI:

```bash
npm install -g @google/gemini-cli
gemini
```

Ollama:

1. Install Ollama from its official website.
2. Download the configured model:

```bash
ollama pull llama3.2
```

For LM Studio, start its local server on port `1234` and load a model before
opening the app's settings.

## Requirements

- macOS, Linux, or another environment capable of running Node.js and the chosen
  AI engine
- Node.js 18 or newer (the server uses built-in `fetch`, `AbortSignal.timeout`,
  and `crypto.randomUUID`)
- npm
- At least one installed and authenticated AI engine, unless mock mode is used
- Internet access for installation and for live research with a web-capable
  engine

The included `start.command` is a macOS convenience launcher. It checks for
`node_modules`, installs dependencies on the first run, waits briefly, opens the
browser, and starts the server.

## Installation and startup

```bash
git clone <your-private-repository-url>
cd content-generator
npm install
npm start
```

Then open [http://localhost:3999](http://localhost:3999).

On macOS, you can alternatively double-click `start.command`. If macOS refuses
to open it after a download, allow it from **System Settings → Privacy &
Security**, or start the app with `npm start` instead.

The server listens only on `127.0.0.1`, so it is not exposed to other devices on
the network by default.

## Daily use

1. Start the app and choose India, Global, or X.
2. Generate a fresh batch of ideas. Research typically takes one to three
   minutes with a web-capable engine.
3. Review the idea, scores, reasoning, and sources.
4. Select **Write this one** and keep the browser tab open while the AI verifies
   the claim and drafts the content.
5. Read the output critically and use the copy buttons for the parts you want.
6. Publish manually on the destination platform.
7. Return to the history and select **Mark as posted**.
8. Add metrics after the post has had time to circulate.
9. Keep doing this: the posted history is the signal that improves future
   suggestions.

Only one AI generation job can run at a time. Starting a second generation or
reply while another is active returns a friendly wait-and-retry message.

X idea batches also carry a freshness timestamp. The interface warns when an
open batch is more than 20 hours old because AI news can become stale quickly.

## History and metrics

Every successful draft is stored immediately with a unique ID, creation time,
market, topic, category, source idea, complete generated package, `draft` status,
and empty metrics.

The history screen lets you:

- Expand a saved entry and recover every generated component
- Copy posts, hooks, comments, replies, hashtags, and supporting notes
- Mark a draft as posted
- Record LinkedIn likes, comments, and impressions
- Record X views, likes, replies, reposts, and bookmarks
- Add a note about who engaged with an X post
- Generate short response options for a comment
- Delete an entry after a browser confirmation

Deleting an item removes it from the active JSON history. The server writes a
`.bak` copy of the previous file before each change, but backup files are
overwritten by later changes and are not a substitute for source control.

## Data layout

There is no external database. All persistent application data lives under
`data/`:

```text
data/
├── engine.json
├── india/
│   ├── content_history.json
│   ├── settings.json
│   └── shown_ideas.json
├── global/
│   ├── content_history.json
│   ├── settings.json
│   └── shown_ideas.json
└── x/
    ├── content_history.json
    ├── settings.json       # created when X rules are saved/reset
    └── shown_ideas.json    # created after the first X idea batch
```

`engine.json` is shared because it describes the current machine's selected AI
engine. The remaining files are isolated by market.

Writes use a temporary file followed by a rename so a partially written JSON
file is less likely to replace good data. Before an existing file is changed,
the app also writes a neighboring `.bak` copy. Temporary, backup, and migrated
files are ignored by Git.

The main JSON files are intentionally tracked by Git. That makes the author's
history, preferences, and learned taste portable across machines, but it also
means commits and pushes can contain unpublished drafts, sources, metrics, and
custom brand rules.

## Privacy and security boundaries

“Local” describes the application server and storage, not necessarily the full
AI workflow.

- The web app and JSON data run locally on the machine.
- The server binds to localhost and has no authentication because it is not
  intended to be publicly hosted.
- When Claude Code, Codex, or Gemini is selected, prompts and relevant history
  context are processed under that provider's signed-in account and policies.
- Web-capable engines may query and fetch external sites during research.
- Ollama and LM Studio can keep inference local, but do not provide live web
  verification in this application.
- This repository tracks the main files in `data/`; pushing it shares their
  contents with everyone who can access the remote repository.
- The application does not publish to LinkedIn or X and does not store social
  network credentials.

Keep the Git repository private. Before sharing the code publicly, remove or
replace the tracked `data/` contents and inspect the Git history, not just the
current files.

## Configuration

### Port

The default port is `3999`. Set `PORT` to use another local port:

```bash
PORT=4000 npm start
```

The server still binds to `127.0.0.1`.

### Mock mode

Mock mode exercises the interface and persistence without calling an AI engine:

```bash
MOCK_CLAUDE=1 npm start
```

Idea and draft requests return fixed fixture data after a short delay. Mock
generations are still saved to the JSON history, so use a disposable checkout or
delete the generated entries afterward if you do not want them mixed with real
history.

### Brand rules

Rules can be changed from the UI for a single market or edited centrally in
`prompts.js`. UI changes persist the entire final rule set to
`data/<market>/settings.json`; after that, code-level default changes do not
replace the saved version unless the app's migration logic detects an older
format or the user selects **Reset to default**.

### Ollama model

The Ollama model is currently fixed as `llama3.2` in `engines.js`. Change the
`model` property there if a different installed model should be used.

## Architecture

The project intentionally has a small dependency surface:

```text
Browser (HTML/CSS/vanilla JS)
        │
        │ JSON requests + Server-Sent Events
        ▼
Express server on 127.0.0.1
        ├── prompt construction and market rules
        ├── JSON-file persistence
        └── AI-engine adapter
                ├── Claude Agent SDK
                ├── Codex CLI
                ├── Gemini CLI
                ├── Ollama CLI
                └── LM Studio HTTP API
```

Long-running idea and post generation uses Server-Sent Events (SSE) so the
browser can display research and thinking progress. The client first sends the
selected idea to the server, then opens the streaming route that performs the
generation. A heartbeat keeps the stream alive during longer work.

The frontend is a single page written in plain JavaScript. It remembers only the
last selected market in browser `localStorage`; content itself is stored by the
server in the repository.

## Project structure

| Path | Responsibility |
|---|---|
| `server.js` | Express server, API routes, SSE job handling, validation, taste-profile construction, migrations, and JSON persistence |
| `prompts.js` | Shared voice rules, market-specific strategies, and all prompt builders/output schemas |
| `engines.js` | Detection and execution adapters for Claude Code, Codex, Gemini, Ollama, and LM Studio |
| `public/index.html` | Single-page application structure |
| `public/app.js` | Market selection, generation flows, rendering, history, metrics, replies, and settings interactions |
| `public/style.css` | Visual styling and responsive layout |
| `data/` | Tracked content history, rules, shown-idea memory, and selected engine |
| `start.command` | macOS double-click launcher |
| `package.json` | Node package metadata, start script, and dependencies |

## API reference

The API is for the bundled frontend and is not designed as a secured public API.
All market-specific routes require one of `india`, `global`, or `x`.

| Method and route | Purpose |
|---|---|
| `GET /api/ideas?market=…` | Stream progress and return a researched idea batch |
| `POST /api/posts/start` | Validate and stage a selected idea for generation |
| `GET /api/posts/stream?market=…` | Stream fact-checking/drafting progress and save the result |
| `POST /api/react` | Create and save an X quick take from pasted material |
| `POST /api/reply` | Generate two short reply options for a comment |
| `GET /api/history?market=…` | Return one market's history |
| `PATCH /api/history/:id?market=…` | Update status, metrics, or notes |
| `DELETE /api/history/:id?market=…` | Delete a history entry |
| `GET /api/engines` | Detect engines and return the current selection |
| `PUT /api/engines` | Save the selected engine |
| `GET /api/settings?market=…` | Return a market's saved or default rules |
| `PUT /api/settings?market=…` | Save non-empty brand rules |
| `POST /api/settings/reset?market=…` | Replace saved rules with current defaults |

Generation responses are required to contain JSON in the shapes defined by the
prompts. The server strips optional Markdown JSON fences, extracts the outermost
object, validates the fields needed for the current flow, and turns common
engine/authentication/format failures into messages suitable for the UI.

If the model reports that it cannot verify the central claim—or writes an
“unable to verify” report in place of a post—the server rejects the draft rather
than saving unsupported content.

## Development and verification

There is currently no automated test suite, build step, linter, or frontend
framework. The most useful local smoke test is mock mode:

```bash
MOCK_CLAUDE=1 npm start
```

Then verify each market in the browser:

1. Generate an idea batch.
2. Generate a post.
3. Expand the new history item.
4. Mark it as posted and enter metrics.
5. Change and reset brand rules.
6. Confirm engine detection in Settings.
7. For X, test the paste-to-take workflow and freshness warning behavior.

Remember that this smoke test writes data. Review `git status` afterward and
restore or delete only the mock entries you created.

## Known constraints

- Only one generation job is supported at a time.
- The app is single-user and should not be deployed directly to the public web.
- The staged idea used between the two post-generation requests is held in
  server memory, so restarting the server between those requests loses it.
- The non-Claude adapters are explicitly marked untested in the current source.
- Local engines cannot search or fact-check against the live web.
- AI output can still be wrong even after research; sources and copy should be
  reviewed before publishing.
- JSON files work well for a personal local tool but are not designed for
  concurrent writers or multi-user workloads.
- Deleting from the UI has no restore button. Git history or the most recent
  `.bak` file may help, but neither should be treated as a guaranteed undo.

## Legacy-data migration

Older versions stored India-only history and settings directly inside `data/`.
At startup, the server copies those files into `data/india/`, renames the old
files with a `.migrated` suffix, and preserves a prior backup when present.

The startup migration can also refresh saved settings when it detects rules from
older market formats. Before replacing them, it writes a `.bak` file beside the
settings file.

## License

No license is currently declared. Treat the repository as private, all rights
reserved code unless the owner adds an explicit license.
