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
          content: `Generate a ${framework} test framework in ${language} for ${targetUrl} (Sauce Demo e-commerce site).

Site structure:
- Login page: username/password fields, login button, error message
- Inventory page: product list, add to cart buttons, cart icon
- Cart page: cart items, checkout button

Generate these files (keep code concise):
1. requirements.txt - just: playwright, pytest, pytest-playwright, pytest-json-report
2. conftest.py - IMPORTANT: use @pytest.fixture(scope="session") for base_url fixture, return "${targetUrl}"
3. pages/login_page.py - LoginPage class with login(), get_error_message() methods
4. pages/inventory_page.py - InventoryPage class with add_to_cart(), get_cart_count() methods
5. pages/cart_page.py - CartPage class with get_items(), checkout() methods
6. tests/test_login.py - 2 tests: successful login, invalid login
7. tests/test_cart.py - 2 tests: add item, verify cart

IMPORTANT RULES:
- conftest.py base_url fixture MUST have scope="session"
- Do NOT create a base_page.py, keep it simple
- Test methods should be functions, not classes
- Use page.goto(base_url) in tests

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
