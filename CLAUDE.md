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

- `providers.js` → `resolveClaudeBin()` checks `CLAUDE_BIN`, `~/.local/bin/claude`, Homebrew paths, `~/.claude/local/claude`, then falls back to `PATH`.
- When spawning `claude-local`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are **stripped from the child env** so Claude Code uses subscription auth instead of paid API-key auth. Don't undo this — it's load-bearing.
- `GET /api/providers` reports availability (detects the local CLI, flags whether env keys exist) so the UI can disable unavailable options.

---

## HTTP API

| Endpoint | Purpose |
|---|---|
| `POST /api/generate` | Body: `{ language, framework, targetUrl, provider?, apiKey? }`. Returns generated files as JSON. |
| `POST /api/run-tests` | Writes files to a tempdir, installs deps, runs tests. Streams output via SSE. |
| `POST /api/download-zip` | Streams a zip of the provided files. |
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

Items completed are on `sec/auth-and-path-traversal` (PR open). Items below are still outstanding.

### ✅ Done
- [x] **C1** Bind Express to `127.0.0.1`; lock CORS to Vite origin; per-process bearer token + `/api/session` bootstrap
- [x] **C4** Path-traversal guard (`safeJoin`) on file write and zip packaging; null-byte + `..` rejection
- [x] **H1** SSRF guard (`assertSafeUrl`): scheme allow-list, private-IP/IMDS block, DNS resolution check, 8s timeout, 200 KB cap
- [x] **C2** `npm install --ignore-scripts`; static scan (`scanGeneratedFiles`) rejects lifecycle hooks, shell-exec patterns, MSBuild `<Exec>`, curl/wget
- [x] **M3/M4** Subprocess hard-kill timeout (`runWithTimeout`, 10 min, env-configurable); tempdir `rm -rf` in `finally`
- [x] **M5 (partial)** Run-tests endpoint now returns generic "Test run failed" instead of raw error message

### 🔲 To do

| ID | Severity | Item |
|----|----------|------|
| C3 | Critical | **Sandbox test execution** — run each language subprocess in a Docker container (`--network=none` for test phase, network only for install/browser-download phase). Blocks true public deployment. |
| H3 | High | **API key storage** — move from `localStorage` to `sessionStorage`; warn user if page is not on `localhost`; scrub key from state on modal close without save. |
| H4 | High | **Rate limiting** — add `express-rate-limit` to `/api/generate` (expensive AI call) and `/api/run-tests` (RCE surface). |
| M1 | Medium | **Helmet** — add `helmet()` middleware with a strict CSP for production builds. |
| M5 | Medium | **Error message sanitisation** — audit all remaining `res.status(500).json({ error: error.message })` calls and replace with generic messages; log real errors server-side only. |
| M6 | Medium | **Debug log cleanup** — gate `console.log("Anthropic API key: ✓ loaded")` and similar startup logs behind `DEBUG=qafg:*`. |
| L3 | Low | **`archiver` error safety** — `archive.on('error')` re-throws inside an async callback; wrap to respond cleanly instead of crashing the process. |
| L4 | Low | **Cache provider detection** — `detectProviders()` spawns `claude --version` on every `/api/providers` poll; cache result for 30 s. |
| L5 | Low | **Input allow-lists** — validate `language` and `framework` from `/api/generate` against known enum values before they enter the prompt. |
| L6 | Low | **File viewer XSS audit** — confirm no `dangerouslySetInnerHTML` or unsanitised render of generated file content in the React viewer; add a test assertion. |

---

## Portfolio context

Portfolio piece targeting QA engineers and senior devs. Code quality, UX polish, and
real-world usability matter. Avoid toy implementations — handle actual constraints
(bot protection, browser compatibility, multi-provider AI, Docker reproducibility).
