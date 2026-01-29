import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { mkdtemp, writeFile, mkdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import archiver from "archiver";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'dist')));
}

const client = new Anthropic();

// Build language-specific file list and rules for the generation prompt
function getLanguagePrompt(language, targetUrl) {
  const lang = (language || 'python').toLowerCase();
  if (lang === 'c#' || lang === 'csharp') {
    return {
      fileList: `Generate these files (keep code concise):
1. .csproj - SDK-style project with Playwright and NUnit (or xUnit) packages
2. Page object .cs files in Pages/ - 2-3 page classes for this site
3. Test .cs files in Tests/ - 2 test files with 2 tests each using NUnit [Test] (or xUnit [Fact])`,
      rules: `CRITICAL RULES for C#:
- Use Microsoft.Playwright and NUnit (or xUnit). Use synchronous API: Page, IBrowserContext, etc.
- Page object constructors take IPage and base URL; expose IsLoaded() that returns bool using defensive checks
- Tests use [Test] and [SetUp] / [OneTimeSetUp] (NUnit) or [Fact] and IClassFixture (xUnit)
- Base URL for tests: "${targetUrl}"
- Use the REAL selectors from the page analysis above
- For IsLoaded(): check page.TitleAsync() or page.Url contains expected text, or locator.CountAsync() > 0
- Do NOT assume credentials; do NOT interact with cookie banners or modals
- Keep tests SIMPLE: verify page loads, title, key navigation
- Use locator.First when multiple matches possible; prefer data-testid, aria-label, or CSS selectors`
    };
  }
  if (lang === 'java') {
    return {
      fileList: `Generate these files (keep code concise):
1. pom.xml - Maven with Playwright and JUnit 5
2. Page object .java files in src/main/java/pages/ - 2-3 page classes
3. Test .java files in src/test/java/ - 2 test classes with 2 tests each`,
      rules: `CRITICAL RULES for Java:
- Use com.microsoft.playwright and JUnit 5. Use synchronous Playwright API.
- Page objects take Page and base URL; isLoaded() returns boolean with defensive checks
- Base URL: "${targetUrl}"
- Use the REAL selectors from the page analysis above
- Do NOT assume credentials; do NOT interact with cookie banners or modals
- Keep tests SIMPLE; prefer data-testid, aria-label, or CSS selectors`
    };
  }
  if (lang === 'javascript') {
    return {
      fileList: `Generate these files (keep code concise):
1. package.json - with @playwright/test (or playwright and mocha/jest)
2. Page object .js or .ts files in pages/ - 2-3 page classes
3. Test files in tests/ - 2 test files with 2 tests each`,
      rules: `CRITICAL RULES for JavaScript/TypeScript:
- Use @playwright/test or playwright with a test runner. Use synchronous API where possible.
- Base URL: "${targetUrl}"
- Use the REAL selectors from the page analysis above
- Do NOT assume credentials; do NOT interact with cookie banners or modals
- Keep tests SIMPLE; prefer data-testid, aria-label, or CSS selectors`
    };
  }
  // Default: Python
  return {
    fileList: `Generate these files (keep code concise):
1. requirements.txt - just: playwright, pytest, pytest-playwright, pytest-json-report
2. conftest.py - IMPORTANT: use @pytest.fixture(scope="session") for base_url fixture, return "${targetUrl}"
3. pages/ - Create 2-3 page object files appropriate for this site
4. tests/ - Create 2 test files with 2 tests each`,
    rules: `CRITICAL RULES:
- Use SYNCHRONOUS Playwright API only (from playwright.sync_api import Page)
- Do NOT use async/await anywhere
- Do NOT use @pytest.mark.asyncio
- Test functions should be regular "def" not "async def"
- conftest.py base_url fixture MUST have scope="session"
- Do NOT create a base_page.py, keep it simple
- Use the REAL selectors from the page analysis above
- For is_loaded() methods, use DEFENSIVE checks:
  - Check page.title() contains expected text, OR
  - Check page.url contains expected path, OR
  - Use page.locator().count() > 0 instead of is_visible() for optional elements
- Tests should verify page loads without errors, not specific elements that may change
- Do NOT assume credentials exist
- Do NOT try to close modals or popups - they are unpredictable
- Do NOT interact with cookie banners or promotional overlays
- Keep tests SIMPLE - verify page loads, title is correct, key navigation works
- When clicking elements, use page.locator("selector").first if multiple matches possible
- Avoid "text=" selectors as they can match hidden screen-reader elements
- Prefer data-testid, aria-label, or specific CSS selectors over text matching`
  };
}

// Helper to extract and validate JSON from Claude's response
function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in response");
  }
  
  let jsonStr = match[0];
  
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.log("Direct parse failed, attempting cleanup...");
  }
  
  throw new Error("Failed to parse JSON from Claude response");
}

app.post("/api/generate", async (req, res) => {
  try {
    const { language, framework, targetUrl } = req.body;

    // Fetch the target page to analyze its structure
    let pageAnalysis = "";
    try {
      const fetchResponse = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = await fetchResponse.text();
      
      // Extract useful selectors from the HTML (limit size for Claude)
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      
      // Find common interactive elements
      const inputs = [...html.matchAll(/<input[^>]*(id|name|placeholder|aria-label)="([^"]+)"[^>]*>/gi)].slice(0, 10);
      const buttons = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/gi)].slice(0, 10);
      const links = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi)].slice(0, 10);
      const forms = [...html.matchAll(/<form[^>]*(id|name|action)="([^"]+)"[^>]*>/gi)].slice(0, 5);
      
      pageAnalysis = `
ACTUAL PAGE ANALYSIS for ${targetUrl}:
- Page title: "${title}"
- Input fields found: ${inputs.map(m => m[2]).join(', ') || 'none detected'}
- Buttons found: ${buttons.map(m => m[1].trim()).filter(b => b.length < 30).join(', ') || 'none detected'}
- Key links: ${links.slice(0, 5).map(m => m[2].trim()).filter(l => l.length < 30).join(', ') || 'none detected'}
- Forms: ${forms.map(m => m[2]).join(', ') || 'none detected'}

USE THESE REAL SELECTORS in your page objects. If specific selectors aren't available, use defensive checks like page.title() or page.url.`;
      
      console.log("Page analysis:", pageAnalysis);
    } catch (fetchError) {
      console.log("Could not fetch target page:", fetchError.message);
      pageAnalysis = `Could not fetch ${targetUrl} for analysis. Generate defensive tests that check page.title(), page.url, and use generic selectors.`;
    }

    const langPrompt = getLanguagePrompt(language, targetUrl);

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: `You are a code generation assistant that outputs ONLY valid JSON.

CRITICAL RULES FOR VALID JSON:
1. All strings must use double quotes
2. Inside string values, escape double quotes as \\"
3. Inside string values, escape newlines as \\n
4. Inside string values, escape backslashes as \\\\
5. No trailing commas
6. No comments
7. Keep code CONCISE - no lengthy docstrings, minimal comments

Your entire response must be a single valid JSON object, nothing else.`,
      messages: [
        {
          role: "user",
          content: `Generate a ${framework} test framework in ${language} for testing: ${targetUrl}

${pageAnalysis}

${langPrompt.fileList}

${langPrompt.rules}

JSON FORMAT:
{"files":[{"name":"filename","path":"folder/","content":"code"}],"summary":"description"}

Use \\n for newlines, \\" for quotes. Output ONLY valid JSON.`
        }
      ]
    });

    const text = message.content[0].text;
    console.log("Raw response:", text.substring(0, 200));
    
    const parsed = extractJSON(text);
    
    res.json({
      content: [{
        text: JSON.stringify(parsed)
      }]
    });
    
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Detect Python command (Docker uses 'python'/'pip', macOS uses 'python3'/'pip3')
const isDocker = process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true';
const PYTHON = isDocker ? 'python' : 'python3';
const PIP = isDocker ? 'pip' : 'pip3';

// Download as ZIP endpoint
app.post("/api/download-zip", async (req, res) => {
  const { files } = req.body;
  
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: "No files provided" });
  }

  try {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=qa-framework.zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err) => {
      throw err;
    });

    archive.pipe(res);

    // Add each file to the ZIP
    for (const file of files) {
      let filePath = (file.path || '').replace(/^\/+|\/+$/g, '');
      let fileName = file.name;
      
      // Handle paths in filename
      if (fileName.includes('/')) {
        const parts = fileName.split('/');
        fileName = parts.pop();
        const fileNamePath = parts.join('/');
        if (!filePath) {
          filePath = fileNamePath;
        }
      }
      
      const fullPath = filePath ? `${filePath}/${fileName}` : fileName;
      archive.append(file.content, { name: fullPath });
    }

    await archive.finalize();
  } catch (error) {
    console.error("ZIP error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Run tests endpoint
app.post("/api/run-tests", async (req, res) => {
  const { files, browser = 'chromium', headed = false } = req.body;
  
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: "No files provided" });
  }

  // Validate browser option
  const validBrowsers = ['chromium', 'firefox', 'webkit'];
  const selectedBrowser = validBrowsers.includes(browser) ? browser : 'chromium';

  let tempDir;
  
  try {
    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), 'qa-framework-'));
    console.log("Created temp dir:", tempDir);

    // Write all files
    for (const file of files) {
      // Handle paths that might be in the filename itself
      let fileName = file.name;
      let filePath = (file.path || '').replace(/^\/+|\/+$/g, ''); // Clean path
      
      // If filename contains a path (e.g., "pages/base_page.py"), extract it
      if (fileName.includes('/')) {
        const parts = fileName.split('/');
        fileName = parts.pop();
        const fileNamePath = parts.join('/');
        
        // Only use the filename's path if file.path is empty or matches
        if (!filePath || filePath === fileNamePath || fileNamePath.startsWith(filePath)) {
          filePath = fileNamePath;
        } else if (!fileNamePath.startsWith(filePath)) {
          // Paths are different and don't overlap, join them
          filePath = join(filePath, fileNamePath);
        }
      }
      
      const fullDir = filePath ? join(tempDir, filePath) : tempDir;
      const fullPath = join(fullDir, fileName);
      
      // Create directory if needed
      if (filePath) {
        await mkdir(fullDir, { recursive: true });
      }
      
      await writeFile(fullPath, file.content);
      console.log("Wrote:", fullPath);
    }

    // Set up SSE for streaming output
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    sendEvent('status', 'Creating virtual environment...');

    // Create virtual environment
    const venvPath = join(tempDir, 'venv');
    const createVenv = spawn(PYTHON, ['-m', 'venv', venvPath], {
      cwd: tempDir
    });

    await new Promise((resolve, reject) => {
      createVenv.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed to create venv with code ${code}`));
      });
      createVenv.on('error', reject);
    });

    // Use the venv's pip and python
    const isWindows = process.platform === 'win32';
    const venvPip = join(venvPath, isWindows ? 'Scripts' : 'bin', 'pip');
    const venvPython = join(venvPath, isWindows ? 'Scripts' : 'bin', 'python');

    sendEvent('status', 'Installing dependencies...');

    // Log requirements.txt content for debugging
    const reqFile = files.find(f => f.name === 'requirements.txt' || f.name.endsWith('requirements.txt'));
    if (reqFile) {
      console.log("Requirements content:", reqFile.content);
    }

    // Install dependencies using venv pip
    const pipInstall = spawn(venvPip, ['install', '-r', 'requirements.txt'], {
      cwd: tempDir
    });

    let pipOutput = '';
    let pipError = '';
    
    pipInstall.stdout.on('data', (data) => {
      pipOutput += data.toString();
      sendEvent('pip', data.toString());
    });

    pipInstall.stderr.on('data', (data) => {
      pipError += data.toString();
      sendEvent('pip', data.toString());
    });

    await new Promise((resolve, reject) => {
      pipInstall.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          console.error("pip install stderr:", pipError);
          console.error("pip install stdout:", pipOutput);
          reject(new Error(`pip install failed with code ${code}: ${pipError || pipOutput}`));
        }
      });
      pipInstall.on('error', (err) => {
        console.error("pip spawn error:", err);
        reject(err);
      });
    });

    sendEvent('status', `Installing Playwright ${selectedBrowser} browser...`);

    // Install Playwright browsers
    const playwrightInstall = spawn(venvPython, ['-m', 'playwright', 'install', selectedBrowser], {
      cwd: tempDir
    });

    playwrightInstall.stdout.on('data', (data) => {
      sendEvent('pip', data.toString());
    });

    playwrightInstall.stderr.on('data', (data) => {
      sendEvent('pip', data.toString());
    });

    await new Promise((resolve, reject) => {
      playwrightInstall.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Non-fatal, might already be installed
          console.log("Playwright install exited with code:", code);
          resolve();
        }
      });
      playwrightInstall.on('error', () => resolve());
    });

    sendEvent('status', `Running tests on ${selectedBrowser}${headed ? ' (headed)' : ''}...`);

    // Build pytest arguments
    const reportPath = join(tempDir, 'report.json');
    const pytestArgs = [
      '-m', 'pytest', 
      '-v', 
      '--tb=short',
      `--browser=${selectedBrowser}`,
      '--json-report',
      `--json-report-file=${reportPath}`,
      '--json-report-indent=2'
    ];
    
    // Add headed flag if enabled
    if (headed) {
      pytestArgs.push('--headed');
    }

    // Run pytest with JSON report
    const pytest = spawn(venvPython, pytestArgs, {
      cwd: tempDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    pytest.stdout.on('data', (data) => {
      sendEvent('test', data.toString());
    });

    pytest.stderr.on('data', (data) => {
      sendEvent('test', data.toString());
    });

    await new Promise((resolve) => {
      pytest.on('close', async (code) => {
        // Try to read and parse the JSON report
        try {
          const { readFile } = await import('fs/promises');
          const reportContent = await readFile(reportPath, 'utf-8');
          const report = JSON.parse(reportContent);
          
          // Send structured report data
          sendEvent('report', {
            summary: {
              total: report.summary?.total || 0,
              passed: report.summary?.passed || 0,
              failed: report.summary?.failed || 0,
              error: report.summary?.error || 0,
              skipped: report.summary?.skipped || 0,
              duration: report.duration || 0
            },
            tests: (report.tests || []).map(t => ({
              nodeid: t.nodeid,
              outcome: t.outcome,
              duration: t.call?.duration || t.setup?.duration || 0,
              setup: t.setup?.outcome,
              call: t.call?.outcome,
              teardown: t.teardown?.outcome,
              error: t.call?.longrepr || t.setup?.longrepr || null,
              stdout: t.call?.stdout || null,
              stderr: t.call?.stderr || null
            })),
            environment: report.environment || {},
            created: report.created
          });
        } catch (e) {
          console.log('Could not read JSON report:', e.message);
        }
        
        sendEvent('complete', { exitCode: code });
        resolve();
      });
      pytest.on('error', (err) => {
        sendEvent('error', err.message);
        resolve();
      });
    });

    res.end();

  } catch (error) {
    console.error("Run tests error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', data: error.message })}\n\n`);
      res.end();
    }
  }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Serve frontend for all other routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});