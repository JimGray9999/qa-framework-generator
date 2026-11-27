# QA Framework Generator — Project Context for Claude Code

## Project overview

AI-powered QA framework generator. A web app analyzes a target website, generates a
complete test automation framework in the chosen language + framework, and executes
the tests with live streaming output and a pass/fail report.

**Repo:** https://github.com/JimGray9999/qa-framework-generator

### Tech stack

- **Frontend:** React (Vite), single-file IDE-style 3-panel layout — config, file tree/code viewer, test report
- **Backend:** Express.js with a pluggable AI provider layer
- **Test execution:** language-specific subprocesses (venv + pytest for Python, `dotnet test` for C#); Docker for packaging
- **Streaming:** Server-Sent Events (SSE) for real-time test output
- **Reporting:** JSON report from pytest-json-report / parsed TRX for .NET, normalized to a common shape
- **Export:** ZIP download of the generated framework

---

## AI provider architecture

The generator is not tied to the Anthropic API. Provider selection lives in `providers.js`
and is chosen via the Settings modal (⚙ in the header). Selection persists in
`localStorage` and is sent with each `/api/generate` request.

| Provider | ID | Auth | Notes |
|---|---|---|---|
| Claude (Local CLI) | `claude-local` | Subscription via `claude` CLI | Default. Spawns `claude -p --output-format text`. No key required. **Does not work inside Docker.** |
| Anthropic API | `anthropic-api` | `ANTHROPIC_API_KEY` (env or Settings) | Uses `@anthropic-ai/sdk`. |
| OpenAI (ChatGPT) | `openai` | `OPENAI_API_KEY` (env or Settings) | Uses the chat-completions endpoint. |

Key implementation details:

- `claudeBin.js` → `resolveClaudeBin()` checks `CLAUDE_BIN`, then known install paths (`~/.local/bin/claude`, Homebrew, `~/.claude/local/claude`; on Windows `claude.exe` in `~/.local/bin` and `~/.claude/local`, and `%APPDATA%\npm\claude.cmd`), then searches `PATH` (Windows: `.exe`/`.cmd`/`.bat`), then falls back to bare `claude`. `spawnClaude()` runs `.cmd`/`.bat` wrappers through a shell on Windows.
- When spawning `claude-local`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are **stripped from the child env** so Claude Code uses subscription auth instead of paid API-key auth. Don't undo this — it's load-bearing.
- `GET /api/providers` reports availability (detects the local CLI, flags whether env keys exist) so the UI can disable unavailable options.

---

## Skills (experimental)

Generation prompts are being migrated from `getLanguagePrompt()` in `server.js` to
skills under `skills/<name>/SKILL.md`. `skills.js` loads a language skill (`## Files`
and `## Rules` sections, `{{targetUrl}}` placeholder) and appends `skills/qa-conventions`.
Python (`qa-playwright-python`) is migrated; other languages fall back to the inline prompt.
Enable via the Settings checkbox (`useSkills` in the `/api/generate` body) or `QAFG_USE_SKILLS=true`.
The response includes `promptSource` so runs can be compared.

---

## Repo analysis (optional pipeline input)

The Agents tab can take the app's source code (public GitHub URL or an uploaded zip). A **Repo Analyst** agent
reads it and produces a validated `repoContext` (pages, forms, auth, how to run, candidate flows, verified
selectors) that the Planner, Architect and Engineer prompts include. The live URL becomes optional: without one
the base URL found in the code (localhost only) or `http://localhost:3000` is used, and no live page is fetched.

Security properties (do not weaken):
- **Archives are untrusted and never touch the disk.** `repo/zipReader.js` is a small in-house reader (stored/deflate
  only; no ZIP64, encryption or symlinks). Entries are read selectively into memory with a hard per-entry output cap
  (`maxOutputLength`, whatever sizes the archive declares), an entry-count cap and bounds-checked offsets. Paths are
  normalised because they appear in prompts.
- **GitHub downloads** (`repo/github.js`): only `github.com` URLs are accepted; the request is built from validated
  `owner/repo/ref` and goes to `api.github.com`; redirects are followed manually and each hop must be `https` on
  `api.github.com` or `codeload.github.com`. Size (`QAFG_MAX_REPO_ZIP_BYTES`, default 25 MB) and time are capped.
  Not verified against the live GitHub API from the dev sandbox (it could not reach GitHub).
- **Secret filtering is best-effort, not a guarantee** (`repo/digest.js`): `.env*`, keys, certs, `credentials*`, etc.
  are never read, and credential-like strings are pattern-redacted. Redaction covers EVERYTHING that leaves the server
  (file samples, scripts, routes, selectors, paths, the rendered prompt, and the analysis that is passed on), runs on
  whole files before clipping (so a secret cannot straddle the cut), and drops metadata that looks like a credential.
  Patterns cannot catch every secret; the UI tells users the source goes to their selected provider and not to attach
  code they would not share with it.
- **Text-only execution for source-derived prompts.** Prompt instructions do not enforce a boundary, so the repository
  routes and every agent that consumes `repoContext` call the provider with `isolated: true`. For the local Claude CLI
  (`claudeIsolation.js`) that means `--tools ""`, `--strict-mcp-config`, `--disable-slash-commands`,
  `--no-session-persistence`, `--settings '{"disableAllHooks":true}'`, an empty scratch cwd and an allow-listed
  environment (`QAFG_CLAUDE_ENV_PASSTHROUGH=A,B` adds names; `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are never passed).
  Verified against `claude` 2.1.332: under the default flags user- and project-level hooks and MCP servers all ran; under
  these none did. `--bare` is not used because it disables subscription login. On Windows the npm `.cmd` wrapper is
  refused in isolated mode (arguments cannot be quoted reliably through a shell); use the native `claude.exe` or an API
  provider (tool-free by construction). Re-check the flags when upgrading the CLI.
- **Prompt injection:** repository text is fenced in `<<<FILE ...>>>` markers, the analyst prompt treats it as data, its
  output is validated and size-capped, and selectors it cites must appear in the deterministic extraction. The
  repo-derived base URL is parsed with `URL` and restricted to loopback hosts (no credentials, valid port). The existing
  human review gates still apply. Fencing is mitigation only; the isolation above is what limits the damage.
- **Resource bounds:** archive inflation is async (zlib thread pool) with a per-entry output cap; every read attempt,
  failed or not, is charged to a decompression budget; overlapping entries are refused; extraction regexes are bounded and
  files are scanned in bounded slices with the event loop yielded between files; each prompt section has a character
  budget and the whole prompt has a hard cap (`DIGEST_LIMITS`).
- Uploads use a per-route raw body parser mounted after auth and the rate limiter, so unauthenticated requests are never buffered.

### Live pages and `/api/generate` (same threat model)

Text from a live page is attacker-controlled too, so the manual and agent paths that analyse one are hardened alike:
- **Isolation:** when a live page was fetched, the prompt runs `isolated` (the local Claude CLI gets no tools, MCP or hooks).
  Downstream stages (Architect, Engineer) stay isolated whenever the URL came from the user, even if their own fetch fails
  (e.g. the analysis cache expired): the plan and architecture they receive were derived from page text.
  `QAFG_ISOLATE_LIVE_PAGES=false` turns this off for live pages only (e.g. Windows with only the npm `.cmd` wrapper, which
  isolated mode refuses); repository content is always isolated and has no such switch.
- **Page text** (`analyzePage`): control characters stripped, whitespace collapsed, credential-like strings redacted, each field
  length-capped, the fence marker removed, and the block fenced as untrusted data. Extraction patterns are bounded (a hostile page
  with 17,000 unclosed `<input ` tags took the old pattern over a second; the new one tens of ms) and at most 120 KB is scanned.
- **`/api/generate` input** (audit item L5): `normalizeGenerateInput` accepts only a known language/framework pair and a real
  http(s) URL without credentials, canonicalised before it reaches a prompt or generated code. The canonical URL is also
  literal-safe (`literalSafeUrl`): `'`, `"`, backtick, `\`, `$`, `|`, `^`, `{`, `}`, `<`, `>` are percent-encoded, because the prompts
  embed it inside string literals in several languages and `URL.toString()` keeps e.g. apostrophes in paths.
- **Model output and file destinations** (`agents/generated.js`): ONE resolver (`resolveGeneratedPath`) decides where a file goes, and
  validation, `/api/generate`, the Engineer, `/api/run-tests` staging and `/api/download-zip` export all use it (it used to be three
  different formulas). `name` may carry a directory; if it repeats or extends `path` (by whole segments) it wins, else it is appended.
  Rejected: `..`, absolute or drive paths, backslashes, control characters, Windows-reserved names (CON, NUL, COM1-9, LPT1-9, also
  with an extension), `< > : " | ? *` (including NTFS `:stream`), trailing dots/spaces in a directory segment, case-insensitive
  duplicates, over-long paths, and out-of-bounds counts/sizes. The canonical `{name, path, content}` is what is returned and stored.
- **Errors:** the generate route returns only deliberately user-facing messages; provider stderr and internals stay in the log.
- **Local CLI timeout:** `QAFG_CLAUDE_TIMEOUT_MS` (default 5 min) stops a CLI that never answers. The CLI runs in its own process group
  (POSIX) and the whole tree is killed (`taskkill /T` on Windows, untested) and confirmed gone BEFORE the request fails, so the scratch dir
  is never removed under a live process.
  Observed on `claude` 2.1.332: in isolated mode a prompt that asks the model to use a tool it does not have sometimes makes the CLI
  stall instead of answering (cause unknown); the timeout bounds it.

---

## HTTP API

| Endpoint | Purpose |
|---|---|
| `POST /api/generate` | Body: `{ language, framework, targetUrl, provider?, apiKey? }`. Returns generated files as JSON. |
| `POST /api/run-tests` | Writes files to a tempdir, installs deps, runs tests. Streams output via SSE. |
| `POST /api/download-zip` | Streams a zip of the provided files. |
| `POST /api/agents/repo/github` | Body: `{ url }` (public `https://github.com/owner/repo[/tree/ref]`). Downloads the repo zip and runs the Repo Analyst. Returns `{ repoContext, info }`. |
| `POST /api/agents/repo/zip` | Raw `application/zip` body (headers `X-QAFG-Filename`, `X-QAFG-Provider`, `X-QAFG-Api-Key`). Same result as the GitHub route. |
| `POST /api/agents/{intake,plan,architect,engineer}` | The agent pipeline. `plan`/`architect`/`engineer` accept an optional `repoContext`; `intake` accepts `hasRepo`. |
| `GET /api/providers` | Lists providers and their availability. |
| `GET /api/health` | Liveness. |

---

## Running locally

```bash
npm install
npm run dev:all   # Vite on :5173, Express on :3001
```

- `.env` is optional. The server boots without any keys — `claude-local` is the default provider.
- If `claude` isn't on the default PATH, set `CLAUDE_BIN=/full/path/to/claude` or prepend `~/.local/bin` to PATH.
- Python test runs need Python 3. `pythonBin.js` probes `python`, `py -3` and `python3` (Windows) or `python3` and `python` (elsewhere) with the run-scoped spawn, keeps those that report Python 3.x, and uses each one's own absolute `sys.executable` path (so launch never depends on the working directory). The Windows `python3` Store placeholder (exit code 9009) is skipped. Venv creation tries each interpreter in turn, so one without `venv`/`ensurepip` (e.g. Debian without `python3-venv`) falls back to the next. Override with `QAFG_PYTHON=/full/path/to/python`.
- `npm run docker:build && npm run docker:up` for containerized runs — but remember `claude-local` won't work inside the container.

---

## Current build status

Python / Playwright is the most mature path. C# / Playwright runs end-to-end via `dotnet test`.
Java and JavaScript/TypeScript prompts exist but have not been validated end-to-end.

Every generated framework now includes:

- Dependency file (`requirements.txt`, `.csproj`, `pom.xml`, `package.json`)
- 2–3 Page Object files and 2 test files (2 tests each)
- **`README.md`** with language-specific prerequisites, install commands, run command, browser/headed toggle, and project tree
- For Python: `conftest.py` with session-scoped `base_url`

**Known working demo targets:** Sauce Demo, The Internet (Dave Haeffner), DemoQA.
**Bot-protected sites:** The server pre-fetches the page's HTML and extracts real selectors
(titles, inputs, buttons, forms) before prompting the model — never guess selectors from URL alone.

---

## Phase 1 objectives — Playwright across all 5 languages

Consistent Playwright support across: **Python, Java, JavaScript, TypeScript, C# / .NET**.

Each language follows the same sequence: project setup → Page Object Model → test authoring
→ reporting → Docker support.

### Language-specific notes

**Python** (reference implementation)
- Runner: `pytest` + `pytest-playwright`
- Fixtures: session-scoped `base_url`, page objects injected via `conftest.py`
- **Sync Playwright API only** — `from playwright.sync_api import Page`. No `async/await`, no `@pytest.mark.asyncio`.
- Test execution: venv created per-run in a tempdir (see `runPythonTests` in `server.js`)

**C# / .NET**
- Runner: NUnit. All test methods are `async Task`.
- Browser install via `dotnet exec bin/Release/net8.0/playwright.dll install <browser>` after build.
- Browser/headed switching reads `Environment.GetEnvironmentVariable("BROWSER" / "HEADED")`.
- Test execution: `dotnet restore` → `dotnet build -c Release` → `dotnet test --logger trx`; TRX parsed to the common report shape.

**Java** — Maven + JUnit 5, sync Playwright API. Not yet validated end-to-end.

**JavaScript / TypeScript** — `@playwright/test` native runner. Not yet validated end-to-end.

---

## Code generation rules

These rules apply to all AI-generated framework output (encoded in the prompts in `server.js`):

1. **Do not pin package versions** unless the language requires it (C# PackageReference versions are pinned).
2. **Python sync API only.**
3. **Session-scoped `base_url` fixture** in Python `conftest.py`.
4. **No `base_page.py`** in simple scaffolds — keep the initial scaffold lean.
5. **Target demo sites by default.** Saucedemo is the primary default.
6. **Fetch and analyze actual HTML** before generating selectors for any custom URL.
7. **Always include a README.md** tailored to language + framework with prerequisites, install commands, run command, browser/headed toggle, and project tree.
8. **Defensive selectors and `is_loaded()` checks** — prefer `data-testid` / `aria-label` / CSS; use `page.title()` / `page.url` / `.count() > 0` rather than assuming specific elements.
9. **No credentials, no modal/cookie-banner interaction** — those are unpredictable and break tests.

---

## Folder structure conventions

Generated frameworks follow this pattern (adapted per language):

```
<framework-name>/
  pages/                 # or Pages/ for C#
    login_page.<ext>
    inventory_page.<ext>
    cart_page.<ext>
  tests/                 # or Tests/ for C#
    test_login.<ext>
    test_navigation.<ext>
  conftest.<ext>          # Python only
  <deps-file>             # requirements.txt / pom.xml / package.json / .csproj
  README.md               # always present
```

---

## Phase roadmap (beyond Phase 1)

| Phase | Scope |
|-------|-------|
| Phase 1 | Playwright E2E across all 5 languages (current — Python and C# validated) |
| Phase 2 | Unit test runners + BDD (pytest, JUnit 5/TestNG, Jest/Vitest, SpecFlow) |
| Phase 3 | REST API testing (Requests+pytest, Rest-Assured, Supertest, RestSharp) |
| Phase 4 | Performance / load testing (Locust, Gatling, k6, NBomber) |

Phase 2+ should not start until all 5 Phase 1 language implementations are validated
end-to-end with passing tests on Sauce Demo.

---

## Security audit — remaining work

Only C3 is outstanding.

### ✅ Done
- [x] **C1** Bind Express to `127.0.0.1`; lock CORS to Vite origin; per-process bearer token + `/api/session` bootstrap
- [x] **C4** Path-traversal guard (`safeJoin`) on file write and zip packaging; null-byte + `..` rejection
- [x] **H1** SSRF guard (`assertSafeUrl`): scheme allow-list, private-IP/IMDS block, DNS resolution check, 8s timeout, 200 KB cap
- [x] **C2** `npm install --ignore-scripts`; static scan (`scanGeneratedFiles`) rejects lifecycle hooks, shell-exec patterns, MSBuild `<Exec>`, curl/wget
- [x] **M3/M4** Subprocess hard-kill timeout (`runWithTimeout`, 10 min, env-configurable); tempdir `rm -rf` in `finally`
- [x] **M5 (partial)** Run-tests endpoint now returns generic "Test run failed" instead of raw error message
- [x] **L5** `/api/generate` validates `language`/`framework` against the known matrix and canonicalises the URL (`normalizeGenerateInput`).
- [x] **H4** Rate limiting via in-house `middleware/rateLimit.js` (per-IP fixed window, separate bucket per route group): `/api/agents/*` 15/min, `/api/generate` 10/min, `/api/run-tests` 5/min. Env overrides: `QAFG_{AGENT,GENERATE,RUNTESTS}_RATE_MAX` and `_RATE_WINDOW_MS` (validated by `config.js`: positive integers, window up to 2^31-1 ms; invalid values warn and fall back to the defaults). Routing is case-sensitive and the limiters sit behind `requireAuth`. Concurrent test runs are capped separately (`middleware/concurrencyGate.js`, `QAFG_MAX_CONCURRENT_RUNS`, default 2): extra requests get a 429. Every run executes under one deadline (`processScope.js`, `QAFG_RUN_TIMEOUT_MS`, default 20 min, covering install/download/build/test for every stack). Subprocesses are tracked per run (process group on POSIX, `taskkill /T` on Windows); on deadline, failure or timeout the whole tree is killed and reaped before the slot is released, and a cancelled run cannot start new processes. A run whose client disconnects keeps its slot until it finishes or hits the deadline. Windows tree-kill is untested.

- [x] **H3** API key moved to `sessionStorage` (`src/settingsStorage.js`; provider and flags stay in `localStorage`); a key left in `localStorage` by an older version is migrated out; the settings dialog warns when the page is not served from localhost. The dialog's draft lives in component state and is discarded when it closes without saving.
- [x] **M1** Security headers with a strict CSP (`middleware/securityHeaders.js`, in-house so no new dependency; `helmet` is an option once installable). `style-src` keeps `'unsafe-inline'` for React inline styles; `script-src` is `'self'` only. Not exercised against a production build in a browser.
- [x] **M5** `/api/providers` no longer returns a raw error message (the rest were done earlier); a test fails if a route answers with `error.message`.
- [x] **M6** Startup key-status logs and content-bearing logs (raw model response, received file list, requirements content) are gated behind `DEBUG=qafg:*` (`debug.js`). Operational logs are unchanged.
- [x] **L3** `archiver` errors no longer throw inside an event callback: a clean 500 if nothing was sent, else the connection is dropped.
- [x] **L4** `detectProviders()` caches the `claude --version` probe for 30 s and shares one in-flight probe.
- [x] **L6** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or similar in `src/`; `tests/security.test.js` fails if one appears.

Tests: `npm test` (node's built-in runner, `tests/*.test.js`).

### 🔲 To do

| ID | Severity | Item |
|----|----------|------|
| C3 | Critical | **Sandbox test execution** — run each language subprocess in a Docker container (`--network=none` for test phase, network only for install/browser-download phase). Blocks true public deployment. |

---

## Portfolio context

Portfolio piece targeting QA engineers and senior devs. Code quality, UX polish, and
real-world usability matter. Avoid toy implementations — handle actual constraints
(bot protection, browser compatibility, multi-provider AI, Docker reproducibility).
