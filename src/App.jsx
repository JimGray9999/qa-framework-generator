import React, { useState, useEffect, useRef } from 'react';
import { useFrameworkStorage } from './useFrameworkStorage';

const loadSettings = () => {
  try {
    const raw = localStorage.getItem('qafg.settings');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { provider: 'claude-local', apiKey: '' };
};

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

const IconGrid = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5"/>
    <rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/>
    <rect x="14" y="14" width="7" height="7" rx="1.5"/>
  </svg>
);

const IconFolder = ({ size = 18, fill = 'none', stroke = 'currentColor', strokeWidth = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>
);

const IconPlay = ({ size = 18, filled = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <polygon points="5,3 19,12 5,21"/>
  </svg>
);

const IconSettings = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

const IconDownload = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
  </svg>
);

const IconLightning = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
);

const IconClock = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 3"/>
  </svg>
);

const IconTrash = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
  </svg>
);

const IconChevron = ({ size = 9, direction = 'down' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    {direction === 'down' && <path d="M19 9l-7 7-7-7"/>}
    {direction === 'right' && <path d="M9 18l6-6-6-6"/>}
  </svg>
);

// ─── Shared primitives ────────────────────────────────────────────────────────

const TrafficLights = ({ size = 10 }) => (
  <div style={{ display: 'flex', gap: '5px' }}>
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#ff5f57' }} />
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#febc2e' }} />
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#28c840' }} />
  </div>
);

const ModeToggle = ({ on, onToggle, trackW = 28, trackH = 17, knobSize = 13 }) => (
  <div
    onClick={onToggle}
    style={{ padding: '9px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
  >
    <div style={{ width: trackW, height: trackH, background: on ? '#6366f1' : '#27272a', borderRadius: '9px', position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
      <div style={{ width: knobSize, height: knobSize, background: on ? '#fff' : '#52525b', borderRadius: '50%', position: 'absolute', top: '2px', left: on ? `${trackW - knobSize - 2}px` : '2px', transition: 'left .2s, background .2s' }} />
    </div>
    <span style={{ fontSize: '12px', color: on ? '#c7d2fe' : '#71717a' }}>{on ? 'Browser' : 'Headless'}</span>
  </div>
);

// ─── Shared style tokens ──────────────────────────────────────────────────────

const sel = {
  width: '100%',
  padding: '9px 12px',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: '7px',
  color: '#e4e4e7',
  fontSize: '13px',
  fontFamily: "'Inter', sans-serif",
  cursor: 'pointer',
  outline: 'none',
};

const lbl = {
  display: 'block',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: '#52525b',
  marginBottom: '7px',
};

// ─── Main component ───────────────────────────────────────────────────────────

const QAFrameworkGenerator = () => {
  const [config, setConfig] = useState({
    language: 'python',
    framework: 'playwright',
    targetUrl: 'https://www.saucedemo.com',
    browser: 'chromium',
    headed: false,
    slowMo: 0,
  });
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [providerStatus, setProviderStatus] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);

  const API_BASE = 'http://localhost:3001';
  const apiFetch = (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    return fetch(`${API_BASE}${path}`, { ...opts, headers });
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/session`)
      .then(r => r.json())
      .then(d => {
        setSessionToken(d.token);
        return fetch(`${API_BASE}/api/providers`, { headers: { Authorization: `Bearer ${d.token}` } });
      })
      .then(r => r.json())
      .then(d => setProviderStatus(d.providers))
      .catch(() => {});
  }, []);

  const saveSettings = (next) => {
    setSettings(next);
    localStorage.setItem('qafg.settings', JSON.stringify(next));
  };

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const [error, setError] = useState(null);
  const [analysisLog, setAnalysisLog] = useState([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testOutput, setTestOutput] = useState([]);
  const [testStatus, setTestStatus] = useState(null);
  const [testReport, setTestReport] = useState(null);
  const [expandedTests, setExpandedTests] = useState({});
  const [activeTab, setActiveTab] = useState('config');

  const { saved, save: saveToLibrary, remove: removeFromLibrary } = useFrameworkStorage();

  const logEndRef = useRef(null);
  const termEndRef = useRef(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [analysisLog]);
  useEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [testOutput]);

  const frameworks = {
    python: ['playwright', 'selenium', 'pytest-bdd'],
    java: ['playwright', 'testng', 'junit', 'cucumber'],
    javascript: ['playwright', 'cypress', 'webdriverio'],
    typescript: ['playwright', 'cypress', 'webdriverio'],
    'C#': ['playwright', 'selenium', 'cypress'],
  };

  const addLog = (message) => {
    setAnalysisLog(prev => [...prev, { time: new Date().toLocaleTimeString(), message }]);
  };

  const generateFramework = async () => {
    setIsGenerating(true);
    setError(null);
    setAnalysisLog([]);
    setGeneratedFiles(null);
    setTestReport(null);
    setTestOutput([]);
    setTestStatus(null);

    addLog('Starting framework generation...');
    addLog(`Target: ${config.targetUrl}`);
    addLog(`Stack: ${config.language} + ${config.framework}`);

    try {
      addLog('Fetching and analyzing target site...');

      const response = await apiFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: config.language,
          framework: config.framework,
          targetUrl: config.targetUrl,
          provider: settings.provider,
          apiKey: settings.apiKey || undefined,
        }),
      });

      const data = await response.json();

      if (data.pageAnalysis) {
        const pa = data.pageAnalysis;
        if (pa.fetched) {
          addLog(`📄 Page title: "${pa.title || 'n/a'}"`);
          if (pa.inputs.length)  addLog(`🔤 Inputs detected: ${pa.inputs.slice(0, 6).join(', ')}`);
          if (pa.buttons.length) addLog(`🔘 Buttons detected: ${pa.buttons.slice(0, 6).join(', ')}`);
          if (pa.links.length)   addLog(`🔗 Links detected: ${pa.links.slice(0, 5).join(', ')}`);
          if (pa.forms.length)   addLog(`📋 Forms detected: ${pa.forms.join(', ')}`);
        } else {
          addLog('⚠️ Could not fetch page — using defensive selectors');
        }
      }
      addLog('Sending to AI for framework generation...');

      if (data.content && data.content[0] && data.content[0].text) {
        const text = data.content[0].text;
        addLog('Parsing generated framework...');

        let cleanText = text.trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleanText = jsonMatch[0];
        cleanText = cleanText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

        try {
          const result = JSON.parse(cleanText);
          if (result.files && Array.isArray(result.files)) {
            setGeneratedFiles(result);
            setActiveFile(result.files[0]?.name);
            addLog(`✓ Generated ${result.files.length} files`);
            saveToLibrary(result, config)
              .then(entry => addLog(`✓ Saved to library as "${entry.name}"`))
              .catch(() => {});
            addLog('Framework ready!');
            setActiveTab('explorer');
          } else {
            throw new Error('Response missing files array');
          }
        } catch (parseError) {
          throw new Error('Failed to parse generated framework.');
        }
      } else if (data.error) {
        throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'API error');
      } else {
        throw new Error('Invalid response from AI');
      }
    } catch (err) {
      setError(err.message);
      addLog(`✗ Error: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const getFileIcon = (filename) => {
    if (filename.endsWith('.py')) return '🐍';
    if (filename.endsWith('.java')) return '☕';
    if (filename.endsWith('.js') || filename.endsWith('.ts')) return '📜';
    if (filename.endsWith('.txt') || filename.endsWith('.toml')) return '📋';
    if (filename.endsWith('.yml') || filename.endsWith('.yaml')) return '⚙️';
    if (filename.endsWith('.md')) return '📝';
    if (filename.endsWith('.cs')) return '🔷';
    return '📄';
  };

  const getFileLang = (filename) => {
    if (filename.endsWith('.py')) return 'Python';
    if (filename.endsWith('.java')) return 'Java';
    if (filename.endsWith('.ts')) return 'TypeScript';
    if (filename.endsWith('.js')) return 'JavaScript';
    if (filename.endsWith('.cs')) return 'C#';
    if (filename.endsWith('.md')) return 'Markdown';
    if (filename.endsWith('.txt')) return 'Plain Text';
    if (filename.endsWith('.xml')) return 'XML';
    if (filename.endsWith('.json')) return 'JSON';
    return 'Text';
  };

  const runTests = async () => {
    if (!generatedFiles) return;
    setIsRunningTests(true);
    setActiveTab('testrun');
    setTestOutput([]);
    setTestStatus(null);
    setTestReport(null);

    try {
      const response = await apiFetch('/api/run-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: generatedFiles.files,
          browser: config.browser,
          headed: config.headed,
          slowMo: config.headed ? config.slowMo : 0,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'status') {
              setTestOutput(prev => [...prev, { type: 'status', text: event.data }]);
            } else if (event.type === 'test' || event.type === 'pip') {
              setTestOutput(prev => [...prev, { type: event.type, text: event.data }]);
            } else if (event.type === 'report') {
              setTestReport(event.data);
            } else if (event.type === 'complete') {
              setTestStatus(event.data.exitCode === 0 ? 'passed' : 'failed');
            } else if (event.type === 'error') {
              setTestOutput(prev => [...prev, { type: 'error', text: event.data }]);
              setTestStatus('error');
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      setTestOutput(prev => [...prev, { type: 'error', text: err.message }]);
      setTestStatus('error');
    } finally {
      setIsRunningTests(false);
    }
  };

  const downloadAsZip = async () => {
    if (!generatedFiles) return;
    try {
      const response = await apiFetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: generatedFiles.files }),
      });
      if (!response.ok) throw new Error('Failed to generate ZIP');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qa-framework-${config.framework}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError('Failed to download ZIP: ' + err.message);
    }
  };

  const toggleTestExpanded = (nodeid) => {
    setExpandedTests(prev => ({ ...prev, [nodeid]: !prev[nodeid] }));
  };

  // ─── Log line color ────────────────────────────────────────────────────────
  const logColor = (msg) => {
    if (msg.startsWith('✓')) return '#4ade80';
    if (msg.startsWith('✗')) return '#f87171';
    if (msg.startsWith('⚠')) return '#fbbf24';
    if (msg.startsWith('📄')) return '#c084fc';
    if (msg.startsWith('🔤') || msg.startsWith('🔘') || msg.startsWith('🔗') || msg.startsWith('📋')) return '#93c5fd';
    return '#3a3a40';
  };

  // ─── Terminal line color ───────────────────────────────────────────────────
  const termColor = (line) => {
    if (line.type === 'status') return '#a78bfa';
    if (line.type === 'error') return '#f87171';
    const t = line.text || '';
    if (t.includes('PASSED') && !t.includes('FAILED')) return '#4ade80';
    if (t.includes('FAILED') || t.includes('ERROR')) return '#f87171';
    if (t.match(/\d+ passed/) && t.match(/in \d/)) return '#fbbf24';
    return '#3a3a40';
  };

  // ─── File tree grouping ───────────────────────────────────────────────────
  const buildFileTree = () => {
    const folders = {};
    const rootFiles = [];
    (generatedFiles?.files || []).forEach(file => {
      const path = file.path?.replace(/^\/+|\/+$/g, '') || '';
      if (path) {
        if (!folders[path]) folders[path] = [];
        folders[path].push(file);
      } else {
        rootFiles.push(file);
      }
    });
    return { folders, rootFiles };
  };

  // ─── Nav items ────────────────────────────────────────────────────────────
  const navItems = [
    { id: 'config',   label: 'Config',   icon: <IconGrid /> },
    { id: 'explorer', label: 'Files',    icon: <IconFolder /> },
    { id: 'testrun',  label: 'Tests',    icon: <IconPlay /> },
    { id: 'library',  label: 'Library',  icon: <IconClock /> },
  ];

  const tabLabel = { config: 'Framework Configuration', explorer: 'File Explorer', testrun: 'Test Runner', library: 'Saved Frameworks' };

  const loadFromLibrary = (entry) => {
    setGeneratedFiles({ files: entry.files });
    setActiveFile(entry.files[0]?.name || null);
    setConfig(prev => ({ ...prev, language: entry.language, framework: entry.framework, targetUrl: entry.targetUrl }));
    setTestReport(null);
    setTestOutput([]);
    setTestStatus(null);
    setActiveTab('explorer');
  };

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const langColor = (lang) => {
    const map = { python: '#3b82f6', java: '#f59e0b', javascript: '#eab308', typescript: '#06b6d4', 'c#': '#a78bfa' };
    return map[lang?.toLowerCase()] || '#6366f1';
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#09090b', fontFamily: "'Inter', sans-serif", color: '#e4e4e7' }}>
      {showSettings && (
        <SettingsModal
          settings={settings}
          providerStatus={providerStatus}
          onSave={(s) => { saveSettings(s); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Left icon rail ── */}
      <div style={{ width: '56px', background: '#0a0a0d', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          {/* Logo mark */}
          <div style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, flexShrink: 0, boxShadow: '0 4px 12px rgba(99,102,241,.4)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {/* Nav icons */}
          {navItems.map(({ id, label, icon }) => (
            <div
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                width: '56px', height: '52px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', gap: '3px',
                borderLeft: activeTab === id ? '2px solid #6366f1' : '2px solid transparent',
                background: activeTab === id ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: activeTab === id ? '#c7d2fe' : '#3f3f46',
                transition: 'all .15s',
              }}
            >
              {icon}
              <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '.04em', marginTop: '1px' }}>{label}</span>
            </div>
          ))}
        </div>
        {/* Setup (bottom) */}
        <div
          onClick={() => setShowSettings(true)}
          style={{ width: '56px', height: '50px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', cursor: 'pointer', color: '#3f3f46', transition: 'color .15s' }}
        >
          <IconSettings />
          <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '.04em' }}>Setup</span>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* ── Top bar ── */}
        <div style={{ height: '52px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px' }}>
            <span style={{ color: '#3f3f46' }}>QA Framework Generator</span>
            <span style={{ color: '#27272a' }}>/</span>
            <span style={{ color: '#a1a1aa', fontWeight: 500 }}>{tabLabel[activeTab]}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 11px', background: 'rgba(34,197,94,.07)', border: '1px solid rgba(34,197,94,.2)', borderRadius: '20px' }}>
              <div className="blink-dot" />
              <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 500 }}>{settings.provider || 'claude-local'}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', borderRadius: '7px', color: '#71717a', fontSize: '12px', fontFamily: "'Inter', sans-serif", cursor: 'pointer' }}
            >
              <IconSettings size={13} />
              Settings
            </button>
          </div>
        </div>

        {/* ── Tab: Config ── */}
        {activeTab === 'config' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Config form */}
            <div style={{ width: '372px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.06)', overflowY: 'auto', padding: '28px 26px' }}>
              <div style={{ marginBottom: '22px' }}>
                <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#f4f4f5', margin: '0 0 5px' }}>Framework Setup</h2>
                <p style={{ fontSize: '12px', color: '#52525b', margin: 0, lineHeight: 1.5 }}>Configure your target site and stack, then let AI generate the scaffold.</p>
              </div>

              {/* Language */}
              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>Language</label>
                <select
                  value={config.language}
                  onChange={(e) => setConfig({ ...config, language: e.target.value, framework: frameworks[e.target.value][0] })}
                  style={sel}
                >
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                  <option value="C#">C#</option>
                </select>
              </div>

              {/* Framework */}
              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>Test Framework</label>
                <select
                  value={config.framework}
                  onChange={(e) => setConfig({ ...config, framework: e.target.value })}
                  style={sel}
                >
                  {frameworks[config.language].map(fw => (
                    <option key={fw} value={fw}>{fw}</option>
                  ))}
                </select>
              </div>

              {/* Target URL */}
              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>Target URL</label>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) setConfig({ ...config, targetUrl: e.target.value }); }}
                  style={{ ...sel, color: '#52525b', fontSize: '12px', marginBottom: '6px' }}
                >
                  <option value="">Quick-pick an example site…</option>
                  <option value="https://www.saucedemo.com">🛒 Sauce Demo (recommended)</option>
                  <option value="https://the-internet.herokuapp.com">🧪 The Internet</option>
                  <option value="https://demoqa.com">📚 DemoQA</option>
                  <option value="https://automationexercise.com">🏋️ Automation Exercise</option>
                  <option value="https://practice.expandtesting.com">🎯 Expand Testing Practice</option>
                </select>
                <input
                  type="url"
                  value={config.targetUrl}
                  onChange={(e) => setConfig({ ...config, targetUrl: e.target.value })}
                  placeholder="https://example.com"
                  style={{ ...sel, fontFamily: "'JetBrains Mono', monospace" }}
                />
              </div>

              {/* Browser + Mode row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
                <div>
                  <label style={lbl}>Browser</label>
                  <select
                    value={config.browser}
                    onChange={(e) => setConfig({ ...config, browser: e.target.value })}
                    style={{ ...sel, padding: '9px 10px', fontSize: '12px' }}
                  >
                    <option value="chromium">Chromium</option>
                    <option value="firefox">Firefox</option>
                    <option value="webkit">WebKit</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Mode</label>
                  <ModeToggle on={config.headed} onToggle={() => setConfig({ ...config, headed: !config.headed })} />
                </div>
              </div>

              {/* Generate button */}
              <button
                onClick={generateFramework}
                disabled={isGenerating}
                style={{ width: '100%', padding: '12px', background: isGenerating ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg,#5b5fc7,#7c3aed)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: isGenerating ? 'not-allowed' : 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', boxShadow: isGenerating ? 'none' : '0 4px 14px rgba(99,102,241,.38)', letterSpacing: '.01em' }}
              >
                {isGenerating
                  ? <><span className="spin-icon">⚙️</span> Generating...</>
                  : <><IconLightning /> Generate Framework</>}
              </button>

              {error && (
                <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '7px', color: '#f87171', fontSize: '12px', lineHeight: 1.5 }}>
                  {error}
                </div>
              )}
            </div>

            {/* Analysis log */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              {/* Terminal header */}
              <div style={{ height: '36px', background: '#060608', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: '8px', flexShrink: 0 }}>
                <TrafficLights />
                <span style={{ fontSize: '11px', color: '#3f3f46', marginLeft: '8px', fontFamily: "'JetBrains Mono', monospace" }}>analysis.log</span>
                <span style={{ marginLeft: 'auto', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: isGenerating ? '#a78bfa' : '#22c55e' }} className={isGenerating ? 'blink-text' : ''}>
                  {isGenerating ? '⏳ working' : '✓ ready'}
                </span>
              </div>
              {/* Log body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', background: '#060609' }}>
                {analysisLog.length === 0 ? (
                  <div style={{ color: '#2a2a2e', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', lineHeight: 1.75, fontStyle: 'italic' }}>Waiting — hit Generate Framework to start...</div>
                ) : (
                  analysisLog.map((log, i) => (
                    <div key={i} style={{ color: logColor(log.message), fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', lineHeight: 1.75, marginBottom: '1px' }}>
                      <span style={{ color: '#2a2a2e', userSelect: 'none', marginRight: '14px' }}>[{log.time}]</span>
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Explorer ── */}
        {activeTab === 'explorer' && (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* File tree sidebar */}
            <div style={{ width: '210px', flexShrink: 0, background: '#080809', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
                <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#3f3f46' }}>Explorer</span>
                <button
                  onClick={downloadAsZip}
                  disabled={!generatedFiles}
                  title="Download ZIP"
                  style={{ background: 'transparent', border: 'none', color: '#3f3f46', cursor: generatedFiles ? 'pointer' : 'not-allowed', display: 'flex', padding: '2px' }}
                >
                  <IconDownload />
                </button>
              </div>

              {!generatedFiles ? (
                <div style={{ padding: '20px 12px', color: '#3f3f46', fontSize: '11px', lineHeight: 1.5 }}>
                  Generate a framework first to explore files.
                </div>
              ) : (() => {
                const { folders, rootFiles } = buildFileTree();
                return (
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {/* Root folder label */}
                    <div style={{ padding: '7px 10px', fontSize: '11px', fontWeight: 600, color: '#52525b', display: 'flex', alignItems: 'center', gap: '5px', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                      <IconFolder size={12} stroke="#52525b" />
                      qa-framework
                    </div>
                    {/* Root files first */}
                    {rootFiles.map(file => {
                      const active = activeFile === file.name;
                      return (
                        <div
                          key={file.name}
                          onClick={() => setActiveFile(file.name)}
                          style={{ padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', borderLeft: active ? '2px solid #6366f1' : '2px solid transparent', background: active ? 'rgba(99,102,241,0.12)' : 'transparent', transition: 'all .12s' }}
                        >
                          <span style={{ fontSize: '13px' }}>{getFileIcon(file.name)}</span>
                          <span style={{ fontSize: '12px', color: active ? '#f4f4f5' : '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                        </div>
                      );
                    })}
                    {/* Folders */}
                    {Object.entries(folders).map(([folderName, files]) => (
                      <div key={folderName} style={{ marginTop: '4px' }}>
                        <div style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '5px', color: '#818cf8', fontSize: '11px', fontWeight: 600 }}>
                          <IconChevron direction="down" />
                          <IconFolder size={13} fill="rgba(99,102,241,.5)" stroke="none" />
                          {folderName}
                        </div>
                        {files.map(file => {
                          const active = activeFile === file.name;
                          return (
                            <div
                              key={file.name}
                              onClick={() => setActiveFile(file.name)}
                              style={{ padding: '5px 12px 5px 26px', display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', borderLeft: active ? '2px solid #6366f1' : '2px solid transparent', background: active ? 'rgba(99,102,241,0.12)' : 'transparent', transition: 'all .12s' }}
                            >
                              <span style={{ fontSize: '13px' }}>{getFileIcon(file.name)}</span>
                              <span style={{ fontSize: '12px', color: active ? '#f4f4f5' : '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Code viewer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
              {/* Tab bar */}
              <div style={{ height: '36px', background: '#0a0a0d', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
                {activeFile && (
                  <div style={{ padding: '0 16px', background: '#111316', borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#c4c4c7', fontWeight: 500 }}>
                    <span>{getFileIcon(activeFile)}</span>
                    {activeFile}
                    <span
                      onClick={() => setActiveFile(null)}
                      style={{ color: '#3f3f46', cursor: 'pointer', marginLeft: '4px', fontSize: '10px' }}
                    >×</span>
                  </div>
                )}
              </div>

              {/* Code + gutter */}
              {!generatedFiles || !activeFile ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3f3f46', fontSize: '13px', background: '#080809' }}>
                  {!generatedFiles ? 'Generate a framework first' : 'Select a file from the tree'}
                </div>
              ) : (() => {
                const content = generatedFiles.files.find(f => f.name === activeFile)?.content || '';
                const lines = content.split('\n');
                return (
                  <div style={{ flex: 1, overflow: 'auto', display: 'flex', background: '#080809' }}>
                    <pre style={{ margin: 0, padding: '14px 10px', background: '#060608', borderRight: '1px solid rgba(255,255,255,.04)', fontSize: '12px', lineHeight: 1.7, color: '#2d2d30', fontFamily: "'JetBrains Mono', monospace", userSelect: 'none', flexShrink: 0, textAlign: 'right', minWidth: '44px', whiteSpace: 'pre' }}>
                      {lines.map((_, i) => `${i + 1}\n`).join('')}
                    </pre>
                    <pre style={{ margin: 0, padding: '14px 20px', fontSize: '12.5px', lineHeight: 1.7, color: '#c9d1d9', fontFamily: "'JetBrains Mono', monospace", flex: 1, whiteSpace: 'pre', tabSize: 4 }}>
                      <code>{content}</code>
                    </pre>
                  </div>
                );
              })()}

              {/* Status bar */}
              <div style={{ height: '24px', background: 'rgba(99,102,241,.1)', borderTop: '1px solid rgba(99,102,241,.18)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: '16px', fontSize: '11px', color: '#52525b', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                <span style={{ color: '#818cf8' }}>{activeFile ? getFileLang(activeFile) : ''}</span>
                <span>UTF-8</span>
                <span>LF</span>
                <span style={{ marginLeft: 'auto' }}>
                  {generatedFiles && activeFile
                    ? `${generatedFiles.files.find(f => f.name === activeFile)?.content.split('\n').length || 0} lines`
                    : ''}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Tests ── */}
        {activeTab === 'testrun' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 22px', gap: '14px' }}>

            {/* Controls bar */}
            <div style={{ background: '#111316', border: '1px solid rgba(255,255,255,.07)', borderRadius: '8px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0, flexWrap: 'wrap' }}>
              <div>
                <div style={lbl}>Browser</div>
                <select
                  value={config.browser}
                  onChange={(e) => setConfig({ ...config, browser: e.target.value })}
                  style={{ padding: '7px 10px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: '6px', color: '#e4e4e7', fontSize: '12px', fontFamily: "'Inter', sans-serif", cursor: 'pointer', outline: 'none' }}
                >
                  <option value="chromium">Chromium</option>
                  <option value="firefox">Firefox</option>
                  <option value="webkit">WebKit</option>
                </select>
              </div>
              <div>
                <div style={lbl}>Mode</div>
                <ModeToggle
                  on={config.headed}
                  onToggle={() => setConfig({ ...config, headed: !config.headed, slowMo: !config.headed ? config.slowMo : 0 })}
                  trackW={28} trackH={16} knobSize={12}
                />
              </div>
              {config.headed && (
                <div>
                  <div style={{ ...lbl, marginBottom: '2px' }}>
                    Slow-mo <span style={{ color: '#a5b4fc', fontFamily: "'JetBrains Mono', monospace" }}>{config.slowMo}ms</span>
                  </div>
                  <input type="range" min="0" max="2000" step="100" value={config.slowMo} onChange={(e) => setConfig({ ...config, slowMo: parseInt(e.target.value, 10) })} style={{ accentColor: '#6366f1' }} />
                </div>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                <button
                  onClick={downloadAsZip}
                  disabled={!generatedFiles}
                  style={{ padding: '8px 16px', background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: '7px', color: '#71717a', fontSize: '12px', fontFamily: "'Inter', sans-serif", cursor: generatedFiles ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <IconDownload size={12} /> Download ZIP
                </button>
                <button
                  onClick={runTests}
                  disabled={!generatedFiles || isRunningTests}
                  style={{ padding: '8px 20px', background: isRunningTests ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg,#22c55e,#16a34a)', border: 'none', borderRadius: '7px', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: (!generatedFiles || isRunningTests) ? 'not-allowed' : 'pointer', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: '7px', boxShadow: isRunningTests ? 'none' : '0 3px 10px rgba(34,197,94,.3)' }}
                >
                  {isRunningTests
                    ? <><span className="spin-icon">🔄</span> Running...</>
                    : <><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg> Run Tests</>}
                </button>
              </div>
            </div>

            {/* Split: terminal + report */}
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', overflow: 'hidden', minHeight: 0 }}>

              {/* Terminal */}
              <div style={{ background: '#060609', border: '1px solid rgba(255,255,255,.06)', borderRadius: '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ height: '34px', borderBottom: '1px solid rgba(255,255,255,.05)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: '8px', flexShrink: 0 }}>
                  <TrafficLights size={9} />
                  <span style={{ fontSize: '11px', color: '#3f3f46', marginLeft: '8px', fontFamily: "'JetBrains Mono', monospace" }}>shell</span>
                  {isRunningTests && <span style={{ fontSize: '11px', color: '#22c55e', marginLeft: 'auto', fontFamily: "'JetBrains Mono', monospace' " }} className="blink-text">● running</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
                  {testOutput.length === 0 && !isRunningTests && (
                    <div style={{ color: '#2a2a2e', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', fontStyle: 'italic' }}>Waiting for test run...</div>
                  )}
                  {testOutput.map((line, i) => (
                    <div key={i} style={{ color: termColor(line), fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {line.type === 'status' ? `► ${line.text}` : line.text}
                    </div>
                  ))}
                  <div ref={termEndRef} />
                </div>
              </div>

              {/* Test Report */}
              <div style={{ background: '#111316', border: '1px solid rgba(255,255,255,.07)', borderRadius: '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {!testReport && testOutput.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#3f3f46', padding: '40px', gap: '12px' }}>
                    <div style={{ fontSize: '3rem', opacity: 0.3 }}>🧪</div>
                    <p style={{ fontSize: '13px', textAlign: 'center', lineHeight: 1.5 }}>Run tests to see the report here</p>
                  </div>
                ) : (
                  <>
                    {/* Report header */}
                    <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#f4f4f5' }}>Test Report</span>
                        {testStatus && (
                          <div style={{
                            padding: '4px 10px',
                            background: testStatus === 'passed' ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
                            border: `1px solid ${testStatus === 'passed' ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'}`,
                            borderRadius: '20px',
                            fontSize: '10px',
                            color: testStatus === 'passed' ? '#4ade80' : '#f87171',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '.05em',
                          }}>
                            {testStatus === 'passed' ? 'All Passed' : testStatus === 'error' ? 'Error' : `${testReport?.summary?.failed || '?'} Failed`}
                          </div>
                        )}
                      </div>

                      {testReport && (() => {
                        const s = testReport.summary || {};
                        const total = s.total || 0;
                        const passed = s.passed || 0;
                        const failed = s.failed || 0;
                        const skipped = s.skipped || 0;
                        const duration = s.duration || 0;
                        return (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginBottom: '12px' }}>
                              <div style={{ background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.18)', borderRadius: '7px', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '22px', fontWeight: 800, color: '#4ade80', lineHeight: 1 }}>{passed}</div>
                                <div style={{ fontSize: '9px', color: '#4ade80', marginTop: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Passed</div>
                              </div>
                              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: '7px', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '22px', fontWeight: 800, color: '#f87171', lineHeight: 1 }}>{failed}</div>
                                <div style={{ fontSize: '9px', color: '#f87171', marginTop: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Failed</div>
                              </div>
                              <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: '7px', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '22px', fontWeight: 800, color: '#52525b', lineHeight: 1 }}>{skipped}</div>
                                <div style={{ fontSize: '9px', color: '#52525b', marginTop: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Skipped</div>
                              </div>
                              <div style={{ background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.15)', borderRadius: '7px', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '22px', fontWeight: 800, color: '#818cf8', lineHeight: 1 }}>{duration.toFixed(1)}s</div>
                                <div style={{ fontSize: '9px', color: '#52525b', marginTop: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Duration</div>
                              </div>
                            </div>
                            {total > 0 && (
                              <div style={{ height: '4px', background: 'rgba(255,255,255,.06)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                                <div style={{ width: `${(passed / total) * 100}%`, background: 'linear-gradient(90deg,#22c55e,#4ade80)' }} />
                                <div style={{ width: `${(failed / total) * 100}%`, background: '#ef4444' }} />
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Test list */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
                      {testReport?.tests?.length > 0 ? testReport.tests.map((test, i) => {
                        const passed = test.outcome === 'passed';
                        const failed = test.outcome === 'failed';
                        return (
                          <div key={i}>
                            <div
                              onClick={() => toggleTestExpanded(test.nodeid)}
                              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '7px', marginBottom: '5px', cursor: 'pointer', background: 'rgba(255,255,255,.02)', border: `1px solid ${passed ? 'rgba(34,197,94,0.15)' : failed ? 'rgba(239,68,68,0.22)' : 'rgba(251,191,36,0.2)'}` }}
                            >
                              <div style={{ width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0, background: passed ? 'rgba(34,197,94,.12)' : failed ? 'rgba(239,68,68,.12)' : 'rgba(251,191,36,.12)', color: passed ? '#4ade80' : failed ? '#f87171' : '#fbbf24' }}>
                                {passed ? '✓' : failed ? '✗' : '○'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: '#e4e4e7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{test.nodeid.split('::').pop()}</div>
                                <div style={{ fontSize: '10px', color: '#52525b', marginTop: '1px' }}>{test.nodeid.split('::').slice(0, -1).join(' › ')}</div>
                              </div>
                              <span style={{ fontSize: '11px', color: '#52525b', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>{(test.duration * 1000).toFixed(0)}ms</span>
                              <div style={{ padding: '3px 9px', borderRadius: '12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', flexShrink: 0, background: passed ? 'rgba(34,197,94,.1)' : failed ? 'rgba(239,68,68,.1)' : 'rgba(251,191,36,.1)', color: passed ? '#4ade80' : failed ? '#f87171' : '#fbbf24', border: `1px solid ${passed ? 'rgba(34,197,94,.25)' : failed ? 'rgba(239,68,68,.3)' : 'rgba(251,191,36,.25)'}` }}>
                                {test.outcome}
                              </div>
                            </div>
                            {expandedTests[test.nodeid] && test.error && (
                              <div style={{ margin: '-2px 0 5px 34px', padding: '10px 12px', background: 'rgba(239,68,68,.05)', border: '1px solid rgba(239,68,68,.2)', borderRadius: '6px' }}>
                                <pre style={{ margin: 0, fontSize: '11px', color: '#f87171', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>{test.error}</pre>
                              </div>
                            )}
                          </div>
                        );
                      }) : (
                        /* Raw output when no structured report */
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', lineHeight: 1.65 }}>
                          {testOutput.map((line, i) => (
                            <div key={i} style={{ color: termColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {line.type === 'status' ? `► ${line.text}` : line.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Library ── */}
        {activeTab === 'library' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
              {saved.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#3f3f46', paddingBottom: '60px' }}>
                  <div style={{ fontSize: '3rem', opacity: 0.25 }}>🗂</div>
                  <p style={{ fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
                    No saved frameworks yet.<br/>Generate one to add it to your library.
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#f4f4f5', margin: 0 }}>Saved Frameworks</h2>
                    <span style={{ fontSize: '11px', color: '#52525b' }}>{saved.length} saved</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '12px' }}>
                    {saved.map(entry => (
                      <div key={entry.id} style={{ background: '#111316', border: '1px solid rgba(255,255,255,.07)', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Name + lang badge */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#f4f4f5', lineHeight: 1.35, wordBreak: 'break-all' }}>{entry.name}</span>
                          <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '20px', background: `${langColor(entry.language)}20`, color: langColor(entry.language), border: `1px solid ${langColor(entry.language)}40`, textTransform: 'capitalize', letterSpacing: '.03em' }}>
                            {entry.language}
                          </span>
                        </div>
                        {/* Meta row */}
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', color: '#52525b', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>{entry.targetUrl}</span>
                          <span style={{ fontSize: '11px', color: '#3f3f46' }}>·</span>
                          <span style={{ fontSize: '11px', color: '#52525b' }}>{entry.fileCount} files</span>
                          <span style={{ fontSize: '11px', color: '#3f3f46' }}>·</span>
                          <span style={{ fontSize: '11px', color: '#3f3f46' }}>{entry.framework}</span>
                        </div>
                        {/* Date + actions */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                          <span style={{ fontSize: '10px', color: '#3f3f46' }}>{fmtDate(entry.createdAt)}</span>
                          <div style={{ display: 'flex', gap: '7px' }}>
                            <button
                              onClick={() => removeFromLibrary(entry.id)}
                              title="Delete"
                              style={{ padding: '5px 7px', background: 'transparent', border: '1px solid rgba(239,68,68,.2)', borderRadius: '6px', color: '#7f1d1d', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all .15s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,.5)'; e.currentTarget.style.color = '#f87171'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,.2)'; e.currentTarget.style.color = '#7f1d1d'; }}
                            >
                              <IconTrash />
                            </button>
                            <button
                              onClick={() => loadFromLibrary(entry)}
                              style={{ padding: '5px 14px', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', borderRadius: '6px', color: '#a5b4fc', cursor: 'pointer', fontSize: '11px', fontWeight: 600, fontFamily: "'Inter', sans-serif", transition: 'all .15s' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,.25)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,.15)'; }}
                            >
                              Load
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>{/* end main */}

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .blink-dot {
          width: 5px; height: 5px; border-radius: 50%; background: #22c55e;
          animation: blink 2s infinite;
        }
        .blink-text { animation: blink 2.5s infinite; }
        .spin-icon { display: inline-block; animation: spin 1s linear infinite; }
        select option { background: #111316; color: #e4e4e7; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(0,0,0,.2); }
        ::-webkit-scrollbar-thumb { background: rgba(99,102,241,.25); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,.45); }
        button:disabled { opacity: 0.5; }
      `}</style>
    </div>
  );
};

// ─── Settings Modal (unchanged) ───────────────────────────────────────────────

const SettingsModal = ({ settings, providerStatus, onSave, onClose }) => {
  const [draft, setDraft] = useState(settings);
  const [saveError, setSaveError] = useState('');
  const providers = [
    { id: 'claude-local',   label: 'Claude (Local CLI) — uses your installed Claude Code, no key needed' },
    { id: 'anthropic-api',  label: 'Anthropic API (Claude)' },
    { id: 'openai',         label: 'OpenAI (ChatGPT)' },
    { id: 'grok',           label: 'Grok (xAI)' },
    { id: 'perplexity',     label: 'Perplexity' },
  ];
  const current    = providerStatus?.[draft.provider];
  const requiresKey = current?.requiresKey;
  const available  = current?.available !== false;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#111316', border: '1px solid rgba(99,102,241,0.35)', borderRadius: '12px', padding: '28px', width: '520px', maxWidth: '90vw', color: '#e4e4e7', fontFamily: "'Inter', sans-serif" }}>
        <h2 style={{ margin: '0 0 10px 0', color: '#a5b4fc', fontSize: '1.1rem' }}>⚙ Settings</h2>
        <p style={{ color: '#71717a', fontSize: '0.8rem', margin: '0 0 8px 0', lineHeight: 1.5 }}>
          Choose which AI generates your test framework. API keys are stored locally in your browser only.
        </p>

        <label style={{ display: 'block', marginTop: '16px', fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '.06em' }}>AI Provider</label>
        <select
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          style={{ width: '100%', marginTop: '6px', padding: '10px', background: 'rgba(255,255,255,.04)', color: '#e4e4e7', border: '1px solid rgba(255,255,255,.1)', borderRadius: '8px', fontFamily: "'Inter', sans-serif", fontSize: '0.85rem', outline: 'none' }}
        >
          {providers.map(p => {
            const st = providerStatus?.[p.id];
            const disabled = st && st.available === false;
            return (
              <option key={p.id} value={p.id} disabled={disabled}>
                {p.label}{disabled ? ' (not installed)' : ''}
              </option>
            );
          })}
        </select>

        {draft.provider === 'claude-local' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            {available ? (
              <>✓ Local Claude CLI detected. No API key required — uses your existing Claude Code session.<div style={{ marginTop: '6px', color: '#71717a' }}>Need to set it up? <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Install Claude Code</a> and run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>claude login</code>.</div></>
            ) : (
              <>✗ Local Claude CLI not detected. <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Install Claude Code</a>, then run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>claude login</code> and restart the server.</>
            )}
          </div>
        )}

        {draft.provider === 'anthropic-api' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Anthropic Console → API Keys</a>. Starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>sk-ant-</code>.
          </div>
        )}

        {draft.provider === 'openai' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>OpenAI Platform → API Keys</a>. Starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>sk-</code>.
          </div>
        )}

        {draft.provider === 'grok' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? <a href="https://console.x.ai" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>xAI Console → API Keys</a>. Starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>xai-</code>.
          </div>
        )}

        {draft.provider === 'perplexity' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Perplexity → API Settings</a>. Starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>pplx-</code>.
          </div>
        )}

        {requiresKey && (
          <>
            <label style={{ display: 'block', marginTop: '16px', fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '.06em' }}>API Key</label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => { setDraft({ ...draft, apiKey: e.target.value }); if (saveError) setSaveError(''); }}
              placeholder={({ 'anthropic-api': 'sk-ant-...', openai: 'sk-...', grok: 'xai-...', perplexity: 'pplx-...' })[draft.provider] || 'sk-...'}
              style={{ width: '100%', marginTop: '6px', padding: '10px', background: 'rgba(255,255,255,.04)', color: '#e4e4e7', border: `1px solid ${saveError ? 'rgba(239,68,68,.6)' : 'rgba(255,255,255,.1)'}`, borderRadius: '8px', fontFamily: "'Inter', sans-serif", fontSize: '0.85rem', boxSizing: 'border-box', outline: 'none' }}
            />
            {saveError && <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#f87171' }}>{saveError}</div>}
          </>
        )}

        <div style={{ marginTop: '24px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'transparent', color: '#71717a', border: '1px solid rgba(255,255,255,.12)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>Cancel</button>
          <button
            onClick={() => {
              if (requiresKey && !draft.apiKey) { setSaveError('Key required, or change to Claude (Local CLI)'); return; }
              onSave(draft);
            }}
            style={{ background: 'linear-gradient(135deg,#5b5fc7,#7c3aed)', color: 'white', border: 'none', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default QAFrameworkGenerator;
