import React, { useState, useEffect } from 'react';

const loadSettings = () => {
  try {
    const raw = localStorage.getItem('qafg.settings');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { provider: 'claude-local', apiKey: '' };
};

const QAFrameworkGenerator = () => {
  const [config, setConfig] = useState({
    language: 'python',
    framework: 'playwright',
    targetUrl: 'https://www.saucedemo.com',
    browser: 'chromium',
    headed: false,
    slowMo: 0
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
    // Fetch the per-process auth token, then load providers.
    fetch(`${API_BASE}/api/session`)
      .then(r => r.json())
      .then(d => {
        setSessionToken(d.token);
        return fetch(`${API_BASE}/api/providers`, {
          headers: { Authorization: `Bearer ${d.token}` }
        });
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

      const response = await apiFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: config.language,
          framework: config.framework,
          targetUrl: config.targetUrl,
          provider: settings.provider,
          apiKey: settings.apiKey || undefined
        })
      });

      const data = await response.json();

      // Show page analysis details in the log
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
        if (jsonMatch) {
          cleanText = jsonMatch[0];
        }
        cleanText = cleanText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

        try {
          const result = JSON.parse(cleanText);
          if (result.files && Array.isArray(result.files)) {
            setGeneratedFiles(result);
            setActiveFile(result.files[0]?.name);
            addLog(`✓ Generated ${result.files.length} files`);
            addLog('Framework ready!');
            setActiveTab('explorer');
          } else {
            throw new Error('Response missing files array');
          }
        } catch (parseError) {
          console.error('Parse error:', parseError);
          throw new Error('Failed to parse generated framework.');
        }
      } else if (data.error) {
        throw new Error(data.error.message || 'API error');
      } else {
        throw new Error('Invalid response from AI');
      }
    } catch (err) {
      console.error('Generation error:', err);
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
    return '📄';
  };

  const runTests = async () => {
    if (!generatedFiles) return;
    
    setIsRunningTests(true);
    setActiveTab('testrun');
    setTestOutput([]);
    setTestStatus(null);
    setTestReport(null);

    try {
      const response = await apiFetch("/api/run-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          files: generatedFiles.files,
          browser: config.browser,
          headed: config.headed,
          slowMo: config.headed ? config.slowMo : 0
        })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
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
            } catch (e) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (err) {
      setTestOutput(prev => [...prev, { type: 'error', text: err.message }]);
      setTestStatus('error');
    } finally {
      setIsRunningTests(false);
    }
  };

  const toggleTestExpanded = (nodeid) => {
    setExpandedTests(prev => ({
      ...prev,
      [nodeid]: !prev[nodeid]
    }));
  };

  const downloadAsZip = async () => {
    if (!generatedFiles) return;
    
    try {
      const response = await apiFetch("/api/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: generatedFiles.files })
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
      console.error('Download error:', err);
      setError('Failed to download ZIP: ' + err.message);
    }
  };

  // Test Report Component
  const TestReportPanel = () => {
    if (!testReport && testOutput.length === 0) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#6b7280',
          padding: '40px'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '16px', opacity: 0.5 }}>🧪</div>
          <p style={{ fontSize: '1rem', marginBottom: '8px' }}>No test results yet</p>
          <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>Click "Run Tests" to execute and see results</p>
        </div>
      );
    }

    const summary = testReport?.summary || {};
    const tests = testReport?.tests || [];
    const total = summary.total || 0;
    const passed = summary.passed || 0;
    const failed = summary.failed || 0;
    const skipped = summary.skipped || 0;
    const duration = summary.duration || 0;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Report Header */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)',
          padding: '20px',
          borderBottom: '1px solid rgba(99, 102, 241, 0.2)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px'
          }}>
            <h2 style={{
              fontSize: '1.25rem',
              fontWeight: '700',
              color: '#e0e0e0',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '1.5rem' }}>📊</span>
              Test Report
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {testReport?.browser && (
                <div style={{
                  padding: '8px 14px',
                  borderRadius: '20px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#a5b4fc',
                  fontWeight: '600',
                  fontSize: '0.8rem',
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  textTransform: 'capitalize'
                }}>
                  {({ chromium: '🌐', firefox: '🦊', webkit: '🧭' }[testReport.browser] || '🌐')} {testReport.browser}{testReport.headed ? ' · headed' : ''}
                </div>
              )}
              {testStatus && (
                <div style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  background: testStatus === 'passed'
                    ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.3) 0%, rgba(22, 163, 74, 0.3) 100%)'
                    : 'linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(220, 38, 38, 0.3) 100%)',
                  color: testStatus === 'passed' ? '#4ade80' : '#f87171',
                  fontWeight: '600',
                  fontSize: '0.85rem',
                  border: `1px solid ${testStatus === 'passed' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'}`
                }}>
                  {testStatus === 'passed' ? '✓ ALL TESTS PASSED' : '✗ TESTS FAILED'}
                </div>
              )}
            </div>
          </div>

          {/* Summary Cards */}
          {testReport && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '12px'
            }}>
              {/* Pass Rate Card */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'center',
                border: '1px solid rgba(99, 102, 241, 0.2)'
              }}>
                <div style={{
                  fontSize: '2rem',
                  fontWeight: '700',
                  background: passRate >= 80 
                    ? 'linear-gradient(135deg, #4ade80, #22c55e)' 
                    : passRate >= 50 
                    ? 'linear-gradient(135deg, #fbbf24, #f59e0b)'
                    : 'linear-gradient(135deg, #f87171, #ef4444)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }}>
                  {passRate}%
                </div>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '4px' }}>Pass Rate</div>
              </div>

              {/* Passed Card */}
              <div style={{
                background: 'rgba(34, 197, 94, 0.1)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'center',
                border: '1px solid rgba(34, 197, 94, 0.3)'
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#4ade80' }}>{passed}</div>
                <div style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '4px' }}>Passed</div>
              </div>

              {/* Failed Card */}
              <div style={{
                background: failed > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 0, 0, 0.2)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'center',
                border: `1px solid ${failed > 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(99, 102, 241, 0.2)'}`
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: failed > 0 ? '#f87171' : '#6b7280' }}>{failed}</div>
                <div style={{ fontSize: '0.75rem', color: failed > 0 ? '#f87171' : '#6b7280', marginTop: '4px' }}>Failed</div>
              </div>

              {/* Skipped Card */}
              <div style={{
                background: skipped > 0 ? 'rgba(251, 191, 36, 0.1)' : 'rgba(0, 0, 0, 0.2)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'center',
                border: `1px solid ${skipped > 0 ? 'rgba(251, 191, 36, 0.3)' : 'rgba(99, 102, 241, 0.2)'}`
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: skipped > 0 ? '#fbbf24' : '#6b7280' }}>{skipped}</div>
                <div style={{ fontSize: '0.75rem', color: skipped > 0 ? '#fbbf24' : '#6b7280', marginTop: '4px' }}>Skipped</div>
              </div>

              {/* Duration Card */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.2)',
                borderRadius: '12px',
                padding: '16px',
                textAlign: 'center',
                border: '1px solid rgba(99, 102, 241, 0.2)'
              }}>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#a5b4fc' }}>{duration.toFixed(1)}s</div>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '4px' }}>Duration</div>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {testReport && total > 0 && (
            <div style={{
              marginTop: '16px',
              height: '8px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '4px',
              overflow: 'hidden',
              display: 'flex'
            }}>
              <div style={{
                width: `${(passed / total) * 100}%`,
                background: 'linear-gradient(90deg, #22c55e, #4ade80)',
                transition: 'width 0.5s ease'
              }} />
              <div style={{
                width: `${(failed / total) * 100}%`,
                background: 'linear-gradient(90deg, #ef4444, #f87171)',
                transition: 'width 0.5s ease'
              }} />
              <div style={{
                width: `${(skipped / total) * 100}%`,
                background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                transition: 'width 0.5s ease'
              }} />
            </div>
          )}
        </div>

        {/* Test List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {tests.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {tests.map((test, index) => (
                <div
                  key={index}
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '8px',
                    border: `1px solid ${
                      test.outcome === 'passed' ? 'rgba(34, 197, 94, 0.3)' :
                      test.outcome === 'failed' ? 'rgba(239, 68, 68, 0.3)' :
                      'rgba(251, 191, 36, 0.3)'
                    }`,
                    overflow: 'hidden'
                  }}
                >
                  <div
                    onClick={() => toggleTestExpanded(test.nodeid)}
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease'
                    }}
                  >
                    {/* Status Icon */}
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: test.outcome === 'passed' 
                        ? 'rgba(34, 197, 94, 0.2)'
                        : test.outcome === 'failed'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(251, 191, 36, 0.2)',
                      color: test.outcome === 'passed' 
                        ? '#4ade80'
                        : test.outcome === 'failed'
                        ? '#f87171'
                        : '#fbbf24',
                      fontSize: '1rem',
                      fontWeight: '700'
                    }}>
                      {test.outcome === 'passed' ? '✓' : test.outcome === 'failed' ? '✗' : '○'}
                    </div>

                    {/* Test Name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.9rem',
                        fontWeight: '500',
                        color: '#e0e0e0',
                        marginBottom: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {test.nodeid.split('::').pop()}
                      </div>
                      <div style={{
                        fontSize: '0.75rem',
                        color: '#6b7280',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {test.nodeid.split('::').slice(0, -1).join(' > ')}
                      </div>
                    </div>

                    {/* Duration */}
                    <div style={{
                      fontSize: '0.8rem',
                      color: '#9ca3af',
                      fontFamily: 'monospace',
                      whiteSpace: 'nowrap'
                    }}>
                      {(test.duration * 1000).toFixed(0)}ms
                    </div>

                    {/* Status Badge */}
                    <div style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      background: test.outcome === 'passed' 
                        ? 'rgba(34, 197, 94, 0.2)'
                        : test.outcome === 'failed'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(251, 191, 36, 0.2)',
                      color: test.outcome === 'passed' 
                        ? '#4ade80'
                        : test.outcome === 'failed'
                        ? '#f87171'
                        : '#fbbf24'
                    }}>
                      {test.outcome}
                    </div>

                    {/* Expand Arrow */}
                    <div style={{
                      color: '#6b7280',
                      transform: expandedTests[test.nodeid] ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform 0.2s ease',
                      fontSize: '0.7rem'
                    }}>
                      ▼
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedTests[test.nodeid] && (
                    <div style={{
                      padding: '12px 16px',
                      borderTop: '1px solid rgba(99, 102, 241, 0.2)',
                      background: 'rgba(0, 0, 0, 0.2)'
                    }}>
                      {test.error ? (
                        <pre style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          color: '#f87171',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'monospace',
                          lineHeight: '1.5'
                        }}>
                          {test.error}
                        </pre>
                      ) : (
                        <div style={{ color: '#4ade80', fontSize: '0.85rem' }}>
                          ✓ Test completed successfully in {(test.duration * 1000).toFixed(0)}ms
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Console Output when no structured report */
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
              padding: '16px',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              lineHeight: '1.6',
              height: '100%',
              overflow: 'auto'
            }}>
              {testOutput.map((line, i) => (
                <div key={i} style={{
                  color: line.type === 'status' ? '#a5b4fc' :
                         line.type === 'error' ? '#f87171' :
                         line.text.includes('PASSED') ? '#4ade80' :
                         line.text.includes('FAILED') ? '#f87171' :
                         line.text.includes('ERROR') ? '#f87171' :
                         '#9ca3af',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}>
                  {line.type === 'status' ? `► ${line.text}` : line.text}
                </div>
              ))}
              {isRunningTests && (
                <div style={{ color: '#a5b4fc', marginTop: '8px' }}>
                  <span style={{ animation: 'pulse 1s infinite' }}>●</span> Running...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const tabs = [
    { id: 'config',   label: '⚡ Framework Config', locked: false },
    { id: 'explorer', label: '📁 File Explorer',    locked: !generatedFiles },
    { id: 'testrun',  label: '🧪 Test Run & Report', locked: !generatedFiles },
  ];

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    background: 'rgba(15, 15, 25, 0.8)',
    border: '1px solid rgba(99, 102, 241, 0.3)',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '0.9rem',
    cursor: 'pointer',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };
  const labelStyle = {
    display: 'block',
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginBottom: '6px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
      color: '#e0e0e0',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'hidden',
    }}>
      {showSettings && (
        <SettingsModal
          settings={settings}
          providerStatus={providerStatus}
          onSave={(s) => { saveSettings(s); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Header ── */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid rgba(99, 102, 241, 0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{
            fontSize: '1.4rem',
            fontWeight: '700',
            background: 'linear-gradient(90deg, #818cf8, #c084fc, #f472b6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: 0,
          }}>
            QA Framework Generator
          </h1>
          <p style={{ color: '#4b5563', fontSize: '0.75rem', margin: '2px 0 0' }}>
            AI-powered test automation scaffold
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          style={{
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            color: '#a5b4fc',
            padding: '8px 14px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontFamily: 'inherit',
          }}
        >
          ⚙ Settings {settings.provider ? `· ${settings.provider}` : ''}
        </button>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '12px 24px 0',
        borderBottom: '1px solid rgba(99, 102, 241, 0.15)',
        flexShrink: 0,
        background: 'rgba(10, 10, 20, 0.4)',
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => !tab.locked && setActiveTab(tab.id)}
            style={{
              padding: '9px 20px',
              background: activeTab === tab.id
                ? 'rgba(99, 102, 241, 0.2)'
                : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid #818cf8'
                : '2px solid transparent',
              borderRadius: '8px 8px 0 0',
              color: tab.locked
                ? '#374151'
                : activeTab === tab.id ? '#c4b5fd' : '#6b7280',
              fontSize: '0.82rem',
              fontWeight: activeTab === tab.id ? '600' : '400',
              cursor: tab.locked ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {tab.label}
            {tab.locked && <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>🔒</span>}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* ─────────────────────────────────────────
          TAB 1: FRAMEWORK CONFIG
      ───────────────────────────────────────── */}
      {activeTab === 'config' && (
        <div style={{
          flex: 1,
          overflow: 'hidden',
          padding: '28px',
          display: 'flex',
          gap: '24px',
          alignItems: 'flex-start',
        }}>
          {/* ── Left: config card ── */}
          <div style={{
            width: '460px',
            flexShrink: 0,
            background: 'rgba(30, 30, 45, 0.8)',
            borderRadius: '14px',
            padding: '32px',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            backdropFilter: 'blur(10px)',
          }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '600', color: '#a5b4fc', marginBottom: '24px', marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚡</span> Framework Configuration
            </h2>

            {/* Language */}
            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Language</label>
              <select
                value={config.language}
                onChange={(e) => setConfig({ ...config, language: e.target.value, framework: frameworks[e.target.value][0] })}
                style={inputStyle}
              >
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="C#">C#</option>
              </select>
            </div>

            {/* Framework */}
            <div style={{ marginBottom: '18px' }}>
              <label style={labelStyle}>Framework</label>
              <select
                value={config.framework}
                onChange={(e) => setConfig({ ...config, framework: e.target.value })}
                style={inputStyle}
              >
                {frameworks[config.language].map(fw => (
                  <option key={fw} value={fw}>{fw}</option>
                ))}
              </select>
            </div>

            {/* Target URL */}
            <div style={{ marginBottom: '24px' }}>
              <label style={labelStyle}>Target URL</label>
              <select
                value=""
                onChange={(e) => { if (e.target.value) setConfig({ ...config, targetUrl: e.target.value }); }}
                style={{ ...inputStyle, color: '#9ca3af', marginBottom: '8px' }}
              >
                <option value="">📋 Choose an example site...</option>
                <optgroup label="Recommended Test Sites">
                  <option value="https://www.saucedemo.com">🛒 Sauce Demo (E-commerce)</option>
                  <option value="https://the-internet.herokuapp.com">🧪 The Internet</option>
                  <option value="https://automationexercise.com">🏋️ Automation Exercise</option>
                  <option value="https://demoqa.com">📚 DemoQA</option>
                  <option value="https://practice.expandtesting.com">🎯 Expand Testing Practice</option>
                </optgroup>
                <optgroup label="Real Sites (May Have Bot Protection)">
                  <option value="https://www.wikipedia.org">📖 Wikipedia</option>
                  <option value="https://news.ycombinator.com">🔶 Hacker News</option>
                  <option value="https://www.github.com">🐙 GitHub</option>
                </optgroup>
              </select>
              <input
                type="url"
                value={config.targetUrl}
                onChange={(e) => setConfig({ ...config, targetUrl: e.target.value })}
                placeholder="https://example.com"
                style={inputStyle}
              />
              <div style={{ fontSize: '0.7rem', color: '#4b5563', marginTop: '5px' }}>
                Select an example or enter your own URL
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={generateFramework}
              disabled={isGenerating}
              style={{
                width: '100%',
                padding: '13px',
                background: isGenerating ? 'rgba(99, 102, 241, 0.3)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                border: 'none',
                borderRadius: '9px',
                color: '#fff',
                fontSize: '0.95rem',
                fontWeight: '600',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontFamily: 'inherit',
              }}
            >
              {isGenerating
                ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⚙️</span> Generating...</>
                : <><span>🚀</span> Generate Framework</>}
            </button>

            {/* Error */}
            {error && (
              <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171', fontSize: '0.8rem' }}>
                {error}
              </div>
            )}
          </div>

          {/* ── Right: analysis log ── */}
          <div style={{
            flex: 1,
            alignSelf: 'stretch',
            background: 'rgba(10, 10, 16, 0.95)',
            borderRadius: '14px',
            border: '1px solid rgba(99, 102, 241, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: '300px',
          }}>
            {/* Log header */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '5px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#27ca3f' }} />
              </div>
              <span style={{ fontSize: '0.72rem', color: '#4b5563', marginLeft: '8px' }}>Page Analysis &amp; Generation Log</span>
              {isGenerating && <span style={{ fontSize: '0.68rem', color: '#818cf8', marginLeft: 'auto', animation: 'pulse 1s infinite' }}>● working</span>}
            </div>
            {/* Log body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px', fontFamily: 'monospace', fontSize: '0.74rem', lineHeight: '1.7' }}>
              {analysisLog.length === 0 ? (
                <div style={{ color: '#374151', fontStyle: 'italic' }}>Waiting — hit Generate Framework to start...</div>
              ) : (
                analysisLog.map((log, i) => (
                  <div key={i} style={{
                    color: log.message.startsWith('✓') ? '#4ade80'
                         : log.message.startsWith('✗') ? '#f87171'
                         : log.message.startsWith('⚠') ? '#fbbf24'
                         : log.message.startsWith('📄') ? '#c084fc'
                         : log.message.startsWith('🔤') || log.message.startsWith('🔘') || log.message.startsWith('🔗') || log.message.startsWith('📋') ? '#a5b4fc'
                         : '#6b7280',
                    marginBottom: '2px',
                  }}>
                    <span style={{ color: '#374151' }}>[{log.time}]</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────
          TAB 2: FILE EXPLORER
      ───────────────────────────────────────── */}
      {activeTab === 'explorer' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 24px' }}>
          {!generatedFiles ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '3rem', opacity: 0.4 }}>📁</div>
              <p>Generate a framework first to explore files</p>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(30,30,45,0.8)', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.2)', overflow: 'hidden' }}>
              {/* IDE Toolbar */}
              <div style={{ padding: '8px 14px', background: 'rgba(15,15,25,0.8)', borderBottom: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }} />
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27ca3f' }} />
                </div>
                <span style={{ fontSize: '0.78rem', color: '#6b7280', marginLeft: '10px' }}>qa-framework</span>
                <span style={{ fontSize: '0.7rem', color: '#374151', marginLeft: 'auto' }}>{generatedFiles.files.length} files</span>
                <button
                  onClick={downloadAsZip}
                  style={{ padding: '5px 12px', background: 'transparent', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '6px', color: '#a5b4fc', fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' }}
                  onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
                  onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                >
                  📦 Download ZIP
                </button>
              </div>

              {/* IDE Body */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Sidebar */}
                <div style={{ width: '200px', background: 'rgba(15,15,25,0.5)', borderRight: '1px solid rgba(99,102,241,0.2)', overflow: 'auto', flexShrink: 0 }}>
                  <div style={{ padding: '10px 12px', fontSize: '0.68rem', fontWeight: '600', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(99,102,241,0.1)' }}>Explorer</div>
                  <div style={{ padding: '8px 0' }}>
                    {(() => {
                      const folders = {};
                      const rootFiles = [];
                      generatedFiles.files.forEach(file => {
                        const path = file.path?.replace(/^\/+|\/+$/g, '') || '';
                        if (path) { if (!folders[path]) folders[path] = []; folders[path].push(file); }
                        else rootFiles.push(file);
                      });
                      return (
                        <>
                          {rootFiles.map(file => (
                            <div key={file.name} onClick={() => setActiveFile(file.name)} style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: activeFile === file.name ? 'rgba(99,102,241,0.2)' : 'transparent', borderLeft: activeFile === file.name ? '2px solid #6366f1' : '2px solid transparent', transition: 'all 0.15s' }}>
                              <span style={{ fontSize: '0.9rem' }}>{getFileIcon(file.name)}</span>
                              <span style={{ fontSize: '0.73rem', color: activeFile === file.name ? '#e0e0e0' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                            </div>
                          ))}
                          {Object.entries(folders).map(([folderName, files]) => (
                            <div key={folderName}>
                              <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#a5b4fc', fontSize: '0.73rem', fontWeight: '500', marginTop: '4px' }}>
                                <span style={{ fontSize: '0.65rem' }}>▼</span><span style={{ fontSize: '0.85rem' }}>📂</span>{folderName}
                              </div>
                              {files.map(file => (
                                <div key={file.name} onClick={() => setActiveFile(file.name)} style={{ padding: '5px 12px 5px 30px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: activeFile === file.name ? 'rgba(99,102,241,0.2)' : 'transparent', borderLeft: activeFile === file.name ? '2px solid #6366f1' : '2px solid transparent', transition: 'all 0.15s' }}>
                                  <span style={{ fontSize: '0.82rem' }}>{getFileIcon(file.name)}</span>
                                  <span style={{ fontSize: '0.71rem', color: activeFile === file.name ? '#e0e0e0' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Code Area */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Active file tab */}
                  <div style={{ display: 'flex', background: 'rgba(15,15,25,0.3)', borderBottom: '1px solid rgba(99,102,241,0.2)', minHeight: '34px' }}>
                    {activeFile && (
                      <div style={{ padding: '7px 16px', background: 'rgba(30,30,45,0.8)', borderRight: '1px solid rgba(99,102,241,0.2)', color: '#e0e0e0', fontSize: '0.73rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {getFileIcon(activeFile)} {activeFile}
                      </div>
                    )}
                  </div>
                  {/* Code + line numbers */}
                  <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
                    {generatedFiles.files.find(f => f.name === activeFile) && (() => {
                      const content = generatedFiles.files.find(f => f.name === activeFile)?.content || '';
                      const lines = content.split('\n');
                      return (
                        <>
                          <div style={{ padding: '12px 0', background: 'rgba(15,15,25,0.3)', borderRight: '1px solid rgba(99,102,241,0.1)', textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>
                            {lines.map((_, i) => (<div key={i} style={{ padding: '0 12px', fontSize: '0.68rem', lineHeight: '1.6', color: '#374151', fontFamily: 'monospace' }}>{i + 1}</div>))}
                          </div>
                          <pre style={{ margin: 0, padding: '12px 16px', fontSize: '0.73rem', lineHeight: '1.6', color: '#c9d1d9', flex: 1, overflow: 'auto' }}>
                            <code>{content}</code>
                          </pre>
                        </>
                      );
                    })()}
                  </div>
                  {/* Status bar */}
                  <div style={{ padding: '4px 12px', background: 'rgba(99,102,241,0.12)', borderTop: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.63rem', color: '#6b7280', flexShrink: 0 }}>
                    <span>{activeFile?.endsWith('.py') ? 'Python' : activeFile?.endsWith('.ts') ? 'TypeScript' : activeFile?.endsWith('.js') ? 'JavaScript' : activeFile?.endsWith('.java') ? 'Java' : activeFile?.endsWith('.cs') ? 'C#' : activeFile?.endsWith('.md') ? 'Markdown' : 'Text'}</span>
                    <span>UTF-8</span>
                    <span style={{ marginLeft: 'auto' }}>{generatedFiles.files.find(f => f.name === activeFile)?.content.split('\n').length || 0} lines</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────
          TAB 3: TEST RUN & REPORT
      ───────────────────────────────────────── */}
      {activeTab === 'testrun' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 24px', gap: '16px' }}>
          {!generatedFiles ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '3rem', opacity: 0.4 }}>🧪</div>
              <p>Generate a framework first to run tests</p>
            </div>
          ) : (
            <>
              {/* Controls bar */}
              <div style={{ background: 'rgba(30,30,45,0.8)', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.2)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', flexShrink: 0 }}>

                {/* Browser */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px' }}>
                  <label style={{ ...labelStyle, marginBottom: '2px' }}>Browser</label>
                  <select value={config.browser} onChange={(e) => setConfig({ ...config, browser: e.target.value })} style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.82rem' }}>
                    <option value="chromium">🌐 Chromium</option>
                    <option value="firefox">🦊 Firefox</option>
                    <option value="webkit">🧭 WebKit (Safari)</option>
                  </select>
                </div>

                {/* Headed toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ ...labelStyle, marginBottom: '2px' }}>Mode</label>
                  <div
                    onClick={() => setConfig({ ...config, headed: !config.headed, slowMo: !config.headed ? config.slowMo : 0 })}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '8px 12px', background: 'rgba(15,15,25,0.5)', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.2)', userSelect: 'none' }}
                  >
                    <div style={{ width: '36px', height: '20px', background: config.headed ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'rgba(75,85,99,0.5)', borderRadius: '10px', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                      <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', left: config.headed ? '18px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                    </div>
                    <span style={{ fontSize: '0.82rem', color: '#e0e0e0', whiteSpace: 'nowrap' }}>{config.headed ? '👁️ Headed' : '👻 Headless'}</span>
                  </div>
                </div>

                {/* Slow-mo (headed only) */}
                {config.headed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' }}>
                    <label style={{ ...labelStyle, marginBottom: '2px' }}>🐢 Test Speed <span style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{config.slowMo}ms</span></label>
                    <input type="range" min="0" max="2000" step="100" value={config.slowMo} onChange={(e) => setConfig({ ...config, slowMo: parseInt(e.target.value, 10) })} style={{ accentColor: '#6366f1', width: '100%' }} />
                  </div>
                )}

                {/* Run button */}
                <button
                  onClick={runTests}
                  disabled={isRunningTests}
                  style={{ marginLeft: 'auto', padding: '10px 24px', background: isRunningTests ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg,#22c55e,#16a34a)', border: 'none', borderRadius: '9px', color: '#fff', fontSize: '0.9rem', fontWeight: '600', cursor: isRunningTests ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  {isRunningTests ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span> Running...</> : <><span>▶️</span> Run Tests</>}
                </button>
              </div>

              {/* Two-pane: Terminal + Report */}
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', overflow: 'hidden', minHeight: 0 }}>

                {/* Terminal log */}
                <div style={{ background: 'rgba(10,10,16,0.95)', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f56' }} />
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e' }} />
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#27ca3f' }} />
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#4b5563', marginLeft: '8px' }}>Terminal</span>
                    {isRunningTests && <span style={{ fontSize: '0.68rem', color: '#22c55e', marginLeft: 'auto', animation: 'pulse 1s infinite' }}>● running</span>}
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: '1.6' }}>
                    {testOutput.length === 0 && !isRunningTests && (
                      <div style={{ color: '#374151', fontStyle: 'italic' }}>Waiting for test run...</div>
                    )}
                    {testOutput.map((line, i) => (
                      <div key={i} style={{ color: line.type === 'status' ? '#818cf8' : line.type === 'error' ? '#f87171' : line.text?.includes('PASSED') ? '#4ade80' : line.text?.includes('FAILED') || line.text?.includes('ERROR') ? '#f87171' : '#6b7280', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {line.type === 'status' ? `► ${line.text}` : line.text}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Report */}
                <div style={{ background: 'rgba(30,30,45,0.8)', borderRadius: '12px', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <TestReportPanel />
                </div>

              </div>
            </>
          )}
        </div>
      )}

      </div>{/* end tab content */}


      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        select option {
          background: #1a1a2e;
          color: #e0e0e0;
        }
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(99, 102, 241, 0.3);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(99, 102, 241, 0.5);
        }
      `}</style>
    </div>
  );
};

const SettingsModal = ({ settings, providerStatus, onSave, onClose }) => {
  const [draft, setDraft] = useState(settings);
  const [saveError, setSaveError] = useState('');
  const providers = [
    { id: 'claude-local', label: 'Claude (Local CLI) — uses your installed Claude Code, no key needed' },
    { id: 'anthropic-api', label: 'Anthropic API (Claude)' },
    { id: 'openai', label: 'OpenAI (ChatGPT)' },
    { id: 'grok', label: 'Grok (xAI)' },
    { id: 'perplexity', label: 'Perplexity' }
  ];
  const current = providerStatus?.[draft.provider];
  const requiresKey = current?.requiresKey;
  const hasEnvKey = current?.hasEnvKey;
  const available = current?.available !== false;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(30,30,45,0.98)', border: '1px solid rgba(99,102,241,0.4)',
          borderRadius: '12px', padding: '28px', width: '520px', maxWidth: '90vw',
          color: '#e0e0e0', fontFamily: 'inherit'
        }}
      >
        <h2 style={{ margin: '0 0 10px 0', color: '#a5b4fc', fontSize: '1.1rem' }}>⚙ Settings</h2>
        <p style={{ color: '#9ca3af', fontSize: '0.8rem', margin: '0 0 8px 0', lineHeight: 1.5 }}>
          Choose which AI generates your test framework. API keys are stored locally in your browser only.
        </p>

        <label style={{ display: 'block', marginTop: '16px', fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase' }}>
          AI Provider
        </label>
        <select
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          style={{
            width: '100%', marginTop: '6px', padding: '10px',
            background: 'rgba(15,15,25,0.8)', color: '#e0e0e0',
            border: '1px solid rgba(99,102,241,0.3)', borderRadius: '8px',
            fontFamily: 'inherit', fontSize: '0.85rem'
          }}
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
              <>
                ✓ Local Claude CLI detected. No API key required — uses your existing Claude Code session.
                <div style={{ marginTop: '6px', color: '#9ca3af' }}>
                  Need to set it up? <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Install Claude Code</a> and run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>claude login</code>.
                </div>
              </>
            ) : (
              <>
                ✗ Local Claude CLI not detected on server.{' '}
                <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Install Claude Code</a>, then run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>claude login</code> and restart the server.
              </>
            )}
          </div>
        )}

        {draft.provider === 'anthropic-api' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? Sign in to the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Anthropic Console → API Keys</a> and create one (starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>sk-ant-</code>). Requires billing credits.
          </div>
        )}

        {draft.provider === 'openai' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? Sign in to the <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>OpenAI Platform → API Keys</a> and create a secret key (starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>sk-</code>). Requires billing credits.
          </div>
        )}

        {draft.provider === 'grok' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? Sign in to the <a href="https://console.x.ai" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>xAI Console → API Keys</a> and create a key (starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>xai-</code>). Requires billing credits.
          </div>
        )}

        {draft.provider === 'perplexity' && (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(99,102,241,0.08)', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', lineHeight: 1.5 }}>
            Need a key? Sign in to <a href="https://www.perplexity.ai/settings/api" target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>Perplexity → API Settings</a> and generate a key (starts with <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>pplx-</code>). Requires a paid plan or credits.
          </div>
        )}

        {requiresKey && (
          <>
            <label style={{ display: 'block', marginTop: '16px', fontSize: '0.75rem', color: '#9ca3af', textTransform: 'uppercase' }}>
              API Key
            </label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => { setDraft({ ...draft, apiKey: e.target.value }); if (saveError) setSaveError(''); }}
              placeholder={({
                'anthropic-api': 'sk-ant-...',
                'openai': 'sk-...',
                'grok': 'xai-...',
                'perplexity': 'pplx-...'
              })[draft.provider] || 'sk-...'}
              style={{
                width: '100%', marginTop: '6px', padding: '10px',
                background: 'rgba(15,15,25,0.8)', color: '#e0e0e0',
                border: `1px solid ${saveError ? 'rgba(239,68,68,0.6)' : 'rgba(99,102,241,0.3)'}`, borderRadius: '8px',
                fontFamily: 'inherit', fontSize: '0.85rem', boxSizing: 'border-box'
              }}
            />
            {saveError && (
              <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#f87171' }}>
                {saveError}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: '24px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', color: '#9ca3af',
              border: '1px solid rgba(156,163,175,0.3)', padding: '8px 16px',
              borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (requiresKey && !draft.apiKey) {
                setSaveError('Key required, or change to Claude (Local CLI)');
                return;
              }
              onSave(draft);
            }}
            style={{
              background: 'linear-gradient(90deg, #6366f1, #a855f7)', color: 'white',
              border: 'none', padding: '8px 18px', borderRadius: '8px',
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default QAFrameworkGenerator;