import React, { useState } from 'react';

const QAFrameworkGenerator = () => {
  const [config, setConfig] = useState({
    language: 'python',
    framework: 'playwright',
    targetUrl: 'https://www.saucedemo.com',
    browser: 'chromium',
    headed: false
  });
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

  const frameworks = {
    python: ['playwright', 'selenium', 'pytest-bdd'],
    java: ['testng', 'junit', 'cucumber'],
    javascript: ['playwright', 'cypress', 'webdriverio'],
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
      addLog('Analyzing target site structure...');
      
      const response = await fetch("http://localhost:3001/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: config.language,
          framework: config.framework,
          targetUrl: config.targetUrl
        })
      });

      const data = await response.json();
      addLog('Received response from AI...');

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
    setTestOutput([]);
    setTestStatus(null);
    setTestReport(null);

    try {
      const response = await fetch("http://localhost:3001/api/run-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          files: generatedFiles.files,
          browser: config.browser,
          headed: config.headed
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
      const response = await fetch("http://localhost:3001/api/download-zip", {
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

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
      color: '#e0e0e0',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      padding: '24px'
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: '32px',
        paddingBottom: '24px',
        borderBottom: '1px solid rgba(99, 102, 241, 0.3)'
      }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          background: 'linear-gradient(90deg, #818cf8, #c084fc, #f472b6)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '8px'
        }}>
          QA Framework Generator
        </h1>
        <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
          Point. Click. Test. Ship.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: generatedFiles ? '280px 1fr 1fr' : '1fr',
        gap: '24px',
        maxWidth: '1800px',
        margin: '0 auto',
        height: 'calc(100vh - 180px)'
      }}>
        {/* Configuration Panel */}
        <div style={{
          background: 'rgba(30, 30, 45, 0.8)',
          borderRadius: '12px',
          padding: '24px',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          backdropFilter: 'blur(10px)',
          height: 'fit-content',
          maxHeight: '100%',
          overflow: 'auto'
        }}>
          <h2 style={{
            fontSize: '1rem',
            fontWeight: '600',
            color: '#a5b4fc',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '1.2rem' }}>⚡</span> Configuration
          </h2>

          {/* Language Select */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.75rem',
              color: '#9ca3af',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Language
            </label>
            <select
              value={config.language}
              onChange={(e) => setConfig({
                ...config,
                language: e.target.value,
                framework: frameworks[e.target.value][0]
              })}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 15, 25, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                color: '#e0e0e0',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="javascript">JavaScript</option>
              <option value="C#">C#</option>
            </select>
          </div>

          {/* Framework Select */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.75rem',
              color: '#9ca3af',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Framework
            </label>
            <select
              value={config.framework}
              onChange={(e) => setConfig({ ...config, framework: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 15, 25, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                color: '#e0e0e0',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              {frameworks[config.language].map(fw => (
                <option key={fw} value={fw}>{fw}</option>
              ))}
            </select>
          </div>

          {/* Target URL Input */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.75rem',
              color: '#9ca3af',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Target URL
            </label>
            
            {/* Example Sites Dropdown */}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setConfig({ ...config, targetUrl: e.target.value });
                }
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 15, 25, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                color: '#9ca3af',
                fontSize: '0.85rem',
                cursor: 'pointer',
                marginBottom: '8px'
              }}
            >
              <option value="">📋 Choose an example site...</option>
              <optgroup label="Recommended Test Sites">
                <option value="https://www.saucedemo.com">🛒 Sauce Demo (E-commerce)</option>
                <option value="https://the-internet.herokuapp.com">🧪 The Internet (Selenium examples)</option>
                <option value="https://automationexercise.com">🏋️ Automation Exercise</option>
                <option value="https://demoqa.com">📚 DemoQA (ToolsQA)</option>
                <option value="https://practice.expandtesting.com">🎯 Expand Testing Practice</option>
              </optgroup>
              <optgroup label="Real Sites (May Have Bot Protection)">
                <option value="https://www.wikipedia.org">📖 Wikipedia</option>
                <option value="https://news.ycombinator.com">🔶 Hacker News</option>
                <option value="https://www.github.com">🐙 GitHub</option>
              </optgroup>
            </select>

            {/* URL Input */}
            <input
              type="url"
              value={config.targetUrl}
              onChange={(e) => setConfig({ ...config, targetUrl: e.target.value })}
              placeholder="https://example.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 15, 25, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                color: '#e0e0e0',
                fontSize: '0.9rem',
                boxSizing: 'border-box'
              }}
            />
            <div style={{
              fontSize: '0.7rem',
              color: '#6b7280',
              marginTop: '4px'
            }}>
              Select an example or enter your own URL
            </div>
          </div>

          {/* Browser Select */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.75rem',
              color: '#9ca3af',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Browser
            </label>
            <select
              value={config.browser}
              onChange={(e) => setConfig({ ...config, browser: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 15, 25, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                color: '#e0e0e0',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <option value="chromium">🌐 Chromium</option>
              <option value="firefox">🦊 Firefox</option>
              <option value="webkit">🧭 WebKit (Safari)</option>
            </select>
          </div>

          {/* Headed Mode Toggle */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
              padding: '12px',
              background: 'rgba(15, 15, 25, 0.5)',
              borderRadius: '8px',
              border: '1px solid rgba(99, 102, 241, 0.2)'
            }}>
              <div
                onClick={(e) => {
                  e.preventDefault();
                  setConfig({ ...config, headed: !config.headed });
                }}
                style={{
                  width: '44px',
                  height: '24px',
                  background: config.headed 
                    ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                    : 'rgba(75, 85, 99, 0.5)',
                  borderRadius: '12px',
                  position: 'relative',
                  transition: 'background 0.2s ease',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                <div style={{
                  width: '20px',
                  height: '20px',
                  background: '#fff',
                  borderRadius: '50%',
                  position: 'absolute',
                  top: '2px',
                  left: config.headed ? '22px' : '2px',
                  transition: 'left 0.2s ease',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }} />
              </div>
              <div>
                <div style={{
                  fontSize: '0.85rem',
                  color: '#e0e0e0',
                  fontWeight: '500'
                }}>
                  {config.headed ? '👁️ Headed Mode' : '👻 Headless Mode'}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: '#6b7280',
                  marginTop: '2px'
                }}>
                  {config.headed ? 'Watch tests run in browser' : 'Tests run in background'}
                </div>
              </div>
            </label>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateFramework}
            disabled={isGenerating}
            style={{
              width: '100%',
              padding: '12px',
              background: isGenerating 
                ? 'rgba(99, 102, 241, 0.3)'
                : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {isGenerating ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⚙️</span>
                Generating...
              </>
            ) : (
              <>
                <span>🚀</span>
                Generate Framework
              </>
            )}
          </button>

          {/* Run Tests Button */}
          {generatedFiles && (
            <button
              onClick={runTests}
              disabled={isRunningTests}
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '12px',
                background: isRunningTests
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.95rem',
                fontWeight: '600',
                cursor: isRunningTests ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              {isRunningTests ? (
                <>
                  <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>🔄</span>
                  Running Tests...
                </>
              ) : (
                <>
                  <span>▶️</span>
                  Run Tests
                </>
              )}
            </button>
          )}

          {/* Download ZIP Button */}
          {generatedFiles && (
            <button
              onClick={downloadAsZip}
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '10px',
                background: 'transparent',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '8px',
                color: '#a5b4fc',
                fontSize: '0.85rem',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)';
              }}
            >
              <span>📦</span>
              Download ZIP
            </button>
          )}

          {/* Analysis Log */}
          {analysisLog.length > 0 && (
            <div style={{
              marginTop: '20px',
              padding: '12px',
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: '8px',
              fontSize: '0.7rem',
              maxHeight: '120px',
              overflowY: 'auto'
            }}>
              {analysisLog.map((log, i) => (
                <div key={i} style={{
                  color: log.message.startsWith('✓') ? '#4ade80' :
                         log.message.startsWith('✗') ? '#f87171' : '#9ca3af',
                  marginBottom: '4px'
                }}>
                  <span style={{ color: '#6b7280' }}>[{log.time}]</span> {log.message}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{
              marginTop: '16px',
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '0.8rem'
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Code Panel - IDE Style */}
        {generatedFiles && (
          <div style={{
            background: 'rgba(30, 30, 45, 0.8)',
            borderRadius: '12px',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            backdropFilter: 'blur(10px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* IDE Header Bar */}
            <div style={{
              padding: '8px 12px',
              background: 'rgba(15, 15, 25, 0.8)',
              borderBottom: '1px solid rgba(99, 102, 241, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {/* Window Controls */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27ca3f' }} />
              </div>
              <span style={{ 
                fontSize: '0.8rem', 
                color: '#6b7280',
                marginLeft: '12px'
              }}>
                qa-framework
              </span>
              <span style={{ 
                fontSize: '0.7rem', 
                color: '#4b5563',
                marginLeft: 'auto'
              }}>
                {generatedFiles.files.length} files
              </span>
            </div>

            {/* IDE Body */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* File Explorer Sidebar */}
              <div style={{
                width: '180px',
                background: 'rgba(15, 15, 25, 0.5)',
                borderRight: '1px solid rgba(99, 102, 241, 0.2)',
                overflow: 'auto',
                flexShrink: 0
              }}>
                {/* Explorer Header */}
                <div style={{
                  padding: '10px 12px',
                  fontSize: '0.7rem',
                  fontWeight: '600',
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid rgba(99, 102, 241, 0.1)'
                }}>
                  Explorer
                </div>

                {/* File Tree */}
                <div style={{ padding: '8px 0' }}>
                  {/* Group files by folder */}
                  {(() => {
                    const folders = {};
                    const rootFiles = [];
                    
                    generatedFiles.files.forEach(file => {
                      const path = file.path?.replace(/^\/+|\/+$/g, '') || '';
                      if (path) {
                        if (!folders[path]) folders[path] = [];
                        folders[path].push(file);
                      } else {
                        rootFiles.push(file);
                      }
                    });

                    return (
                      <>
                        {/* Root files */}
                        {rootFiles.map(file => (
                          <div
                            key={file.name}
                            onClick={() => setActiveFile(file.name)}
                            style={{
                              padding: '6px 12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              cursor: 'pointer',
                              background: activeFile === file.name ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                              borderLeft: activeFile === file.name ? '2px solid #6366f1' : '2px solid transparent',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <span style={{ fontSize: '0.9rem' }}>{getFileIcon(file.name)}</span>
                            <span style={{
                              fontSize: '0.75rem',
                              color: activeFile === file.name ? '#e0e0e0' : '#9ca3af',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {file.name}
                            </span>
                          </div>
                        ))}

                        {/* Folders */}
                        {Object.entries(folders).map(([folderName, files]) => (
                          <div key={folderName}>
                            {/* Folder Header */}
                            <div style={{
                              padding: '6px 12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              color: '#a5b4fc',
                              fontSize: '0.75rem',
                              fontWeight: '500',
                              marginTop: '4px'
                            }}>
                              <span style={{ fontSize: '0.7rem' }}>▼</span>
                              <span style={{ fontSize: '0.85rem' }}>📂</span>
                              {folderName}
                            </div>
                            {/* Folder Files */}
                            {files.map(file => (
                              <div
                                key={file.name}
                                onClick={() => setActiveFile(file.name)}
                                style={{
                                  padding: '5px 12px 5px 32px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  cursor: 'pointer',
                                  background: activeFile === file.name ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                                  borderLeft: activeFile === file.name ? '2px solid #6366f1' : '2px solid transparent',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <span style={{ fontSize: '0.85rem' }}>{getFileIcon(file.name)}</span>
                                <span style={{
                                  fontSize: '0.73rem',
                                  color: activeFile === file.name ? '#e0e0e0' : '#9ca3af',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {file.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Code Editor Area */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Tab Bar */}
                <div style={{
                  display: 'flex',
                  background: 'rgba(15, 15, 25, 0.3)',
                  borderBottom: '1px solid rgba(99, 102, 241, 0.2)',
                  minHeight: '35px'
                }}>
                  {activeFile && (
                    <div style={{
                      padding: '8px 16px',
                      background: 'rgba(30, 30, 45, 0.8)',
                      borderRight: '1px solid rgba(99, 102, 241, 0.2)',
                      color: '#e0e0e0',
                      fontSize: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      {getFileIcon(activeFile)} {activeFile}
                      <span style={{ 
                        color: '#6b7280', 
                        marginLeft: '8px',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        lineHeight: 1
                      }}>×</span>
                    </div>
                  )}
                </div>

                {/* Code Content with Line Numbers */}
                <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
                  {generatedFiles.files.find(f => f.name === activeFile) && (() => {
                    const content = generatedFiles.files.find(f => f.name === activeFile)?.content || '';
                    const lines = content.split('\n');
                    return (
                      <>
                        {/* Line Numbers */}
                        <div style={{
                          padding: '12px 0',
                          background: 'rgba(15, 15, 25, 0.3)',
                          borderRight: '1px solid rgba(99, 102, 241, 0.1)',
                          textAlign: 'right',
                          userSelect: 'none',
                          flexShrink: 0
                        }}>
                          {lines.map((_, i) => (
                            <div key={i} style={{
                              padding: '0 12px',
                              fontSize: '0.7rem',
                              lineHeight: '1.6',
                              color: '#4b5563',
                              fontFamily: 'monospace'
                            }}>
                              {i + 1}
                            </div>
                          ))}
                        </div>
                        {/* Code */}
                        <pre style={{
                          margin: 0,
                          padding: '12px 16px',
                          fontSize: '0.75rem',
                          lineHeight: '1.6',
                          color: '#c9d1d9',
                          flex: 1,
                          overflow: 'auto'
                        }}>
                          <code>{content}</code>
                        </pre>
                      </>
                    );
                  })()}
                </div>

                {/* Status Bar */}
                <div style={{
                  padding: '4px 12px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  borderTop: '1px solid rgba(99, 102, 241, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  fontSize: '0.65rem',
                  color: '#9ca3af'
                }}>
                  <span>
                    {activeFile?.endsWith('.py') ? 'Python' : 
                     activeFile?.endsWith('.txt') ? 'Plain Text' : 
                     activeFile?.endsWith('.ini') ? 'INI' : 'File'}
                  </span>
                  <span>UTF-8</span>
                  <span style={{ marginLeft: 'auto' }}>
                    {generatedFiles.files.find(f => f.name === activeFile)?.content.split('\n').length || 0} lines
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Test Report Panel */}
        {generatedFiles && (
          <div style={{
            background: 'rgba(30, 30, 45, 0.8)',
            borderRadius: '12px',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            backdropFilter: 'blur(10px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <TestReportPanel />
          </div>
        )}
      </div>

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

export default QAFrameworkGenerator;