import React, { useState, useRef, useEffect } from 'react';

// Four-agent pipeline UI: Intake -> Test Planner -> Architect -> Automation Engineer.
// The client holds each agent's artifact, so the user can review and edit the plan
// and architecture before the next agent runs (human-in-the-loop gates).

const AGENTS = [
  { id: 'intake',    name: 'Intake',               role: 'Understands your request' },
  { id: 'planner',   name: 'Test Planner',         role: 'Drafts the test plan' },
  { id: 'architect', name: 'Architect',            role: 'Designs the framework' },
  { id: 'engineer',  name: 'Automation Engineer',  role: 'Writes the code' },
];

// stage -> index of the agent currently active
const STAGE_AGENT = { intake: 0, planning: 1, plan_review: 1, architecting: 2, arch_review: 2, coding: 3, done: 3 };
const WORKING = new Set(['planning', 'architecting', 'coding']);
const GATES = new Set(['plan_review', 'arch_review']);

const card = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: '10px' };
const btn = (primary, disabled) => ({
  padding: '8px 16px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, fontFamily: "'Inter', sans-serif",
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  border: primary ? 'none' : '1px solid rgba(255,255,255,.12)',
  background: primary ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
  color: primary ? '#fff' : '#a1a1aa',
});
const prioColor = { P0: '#f87171', P1: '#fbbf24', P2: '#60a5fa' };

const Spinner = () => (
  <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid rgba(165,180,252,.3)', borderTopColor: '#a5b4fc', borderRadius: '50%', animation: 'qafg-spin .8s linear infinite' }} />
);

export default function AgentPipeline({ apiFetch, settings, onFrameworkReady, onOpenFiles }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Describe what you want to test. For example: "Test the login and checkout flow of https://www.saucedemo.com using Python and Playwright."' },
  ]);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState('intake');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [request, setRequest] = useState(null);
  const [testPlan, setTestPlan] = useState(null);
  const [included, setIncluded] = useState({});
  const [architecture, setArchitecture] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [result, setResult] = useState(null);
  const [view, setView] = useState('all'); // 'all' or an agent id: which agent's output to show
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);
  // A new stage produces new output, so go back to the full view rather than hide it.
  useEffect(() => { setView('all'); }, [stage]);

  const post = async (path, body) => {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, provider: settings.provider, apiKey: settings.apiKey || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const reset = () => {
    setMessages(m => m.slice(0, 1)); setStage('intake'); setError(null); setRequest(null);
    setTestPlan(null); setArchitecture(null); setWarnings([]); setResult(null); setIncluded({});
  };

  const runPlanner = async (req) => {
    setStage('planning'); setError(null);
    try {
      const data = await post('/api/agents/plan', { request: req });
      setRequest(data.request);
      setTestPlan(data.testPlan);
      setIncluded(Object.fromEntries(data.testPlan.scenarios.map(s => [s.id, true])));
      setStage('plan_review');
    } catch (e) { setError(e.message); setStage('intake'); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || stage !== 'intake') return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next); setInput(''); setBusy(true); setError(null);
    try {
      const data = await post('/api/agents/intake', { messages: next.slice(1) });
      setMessages(m => [...m, { role: 'assistant', content: data.reply }]);
      if (data.status === 'ready') { setBusy(false); await runPlanner(data.request); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const approvedPlan = () => ({ ...testPlan, scenarios: testPlan.scenarios.filter(s => included[s.id]) });
  const nIncluded = testPlan ? testPlan.scenarios.filter(s => included[s.id]).length : 0;

  const runArchitect = async () => {
    setStage('architecting'); setError(null);
    try {
      const data = await post('/api/agents/architect', { request, testPlan: approvedPlan() });
      setArchitecture(data.architecture);
      setStage('arch_review');
    } catch (e) { setError(e.message); setStage('plan_review'); }
  };

  const runEngineer = async () => {
    setStage('coding'); setError(null);
    try {
      const data = await post('/api/agents/engineer', { request, testPlan: approvedPlan(), architecture });
      const parsed = JSON.parse(data.content[0].text);
      setWarnings(data.warnings || []);
      setResult(parsed);
      onFrameworkReady(parsed, request, { testPlan: approvedPlan(), architecture });
      setStage('done');
    } catch (e) { setError(e.message); setStage('arch_review'); }
  };

  const editScenario = (id, patch) =>
    setTestPlan(p => ({ ...p, scenarios: p.scenarios.map(s => (s.id === id ? { ...s, ...patch } : s)) }));

  const hasOutput = { intake: !!request, planner: !!testPlan, architect: !!architecture, engineer: stage === 'coding' || !!result };
  const show = (id) => view === 'all' || view === id;

  const active = STAGE_AGENT[stage];
  const agentState = (i) => (i < active ? 'done' : i > active ? 'idle' : stage === 'done' ? 'done' : WORKING.has(stage) ? 'working' : GATES.has(stage) ? 'review' : 'active');

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <style>{'@keyframes qafg-spin{to{transform:rotate(360deg)}}'}</style>

      {/* ── Left: chat with Intake agent ── */}
      <div style={{ width: '372px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.06)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '22px 22px 10px' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#f4f4f5', margin: '0 0 5px' }}>Intake Agent</h2>
          <p style={{ fontSize: '12px', color: '#52525b', margin: 0, lineHeight: 1.5 }}>Tell it what to test and with which stack. It asks only if something is missing.</p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 22px' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
              <div style={{ maxWidth: '88%', padding: '9px 12px', borderRadius: 10, fontSize: '12.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.05)', color: m.role === 'user' ? '#c7d2fe' : '#d4d4d8' }}>
                {m.content}
              </div>
            </div>
          ))}
          {busy && <div style={{ color: '#71717a', fontSize: 12 }}><Spinner /> Intake agent is thinking...</div>}
          <div ref={endRef} />
        </div>
        <div style={{ padding: '12px 22px 20px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
          {request && (
            <div style={{ fontSize: 11, color: '#71717a', marginBottom: 10, lineHeight: 1.6 }}>
              <b style={{ color: '#a1a1aa' }}>{request.language} + {request.framework}</b> · {request.targetUrl}
            </div>
          )}
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={stage !== 'intake' || busy}
            rows={3}
            placeholder={stage === 'intake' ? 'What should we test?' : 'Request captured. Review the pipeline on the right.'}
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, color: '#e4e4e7', fontSize: 13, fontFamily: "'Inter', sans-serif", resize: 'none', outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={send} disabled={stage !== 'intake' || busy || !input.trim()} style={btn(true, stage !== 'intake' || busy || !input.trim())}>Send</button>
            {stage !== 'intake' && <button onClick={reset} disabled={WORKING.has(stage)} style={btn(false, WORKING.has(stage))}>New request</button>}
          </div>
        </div>
      </div>

      {/* ── Right: pipeline ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', minWidth: 0 }}>
        {/* Stepper */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
          {AGENTS.map((a, i) => {
            const st = agentState(i);
            const color = st === 'done' ? '#4ade80' : st === 'review' ? '#fbbf24' : st === 'working' || st === 'active' ? '#a5b4fc' : '#3f3f46';
            const clickable = hasOutput[a.id];
            const selected = view === a.id;
            return (
              <button
                key={a.id}
                type="button"
                disabled={!clickable}
                aria-pressed={selected}
                title={clickable ? (selected ? 'Click to show all agents' : `Show only ${a.name} output`) : 'No output yet'}
                onClick={() => setView(v => (v === a.id ? 'all' : a.id))}
                style={{
                  ...card, flex: 1, padding: '12px 14px', textAlign: 'left', font: 'inherit', color: 'inherit',
                  cursor: clickable ? 'pointer' : 'default',
                  borderColor: selected ? color : st === 'idle' ? 'rgba(255,255,255,.05)' : color + '55',
                  background: selected ? 'rgba(99,102,241,.12)' : card.background,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color }}>
                  {st === 'working' ? <Spinner /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />}
                  {st === 'review' ? 'Awaiting you' : st === 'idle' ? 'Waiting' : st === 'done' ? 'Done' : st === 'working' ? 'Working' : 'Active'}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7', marginTop: 6 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>{a.role}</div>
              </button>
            );
          })}
        </div>

        {view !== 'all' && (
          <div style={{ fontSize: 12, color: '#71717a', margin: '-8px 0 14px' }}>
            Showing {AGENTS.find(a => a.id === view)?.name} output only.{' '}
            <button type="button" onClick={() => setView('all')} style={{ background: 'none', border: 'none', padding: 0, color: '#a5b4fc', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>Show all</button>
          </div>
        )}

        {error && (
          <div style={{ ...card, padding: '10px 14px', marginBottom: 16, borderColor: 'rgba(248,113,113,.35)', color: '#fca5a5', fontSize: 12.5 }}>{error}</div>
        )}

        {stage === 'intake' && !error && (
          <div style={{ ...card, padding: 28, color: '#52525b', fontSize: 13, textAlign: 'center' }}>
            The pipeline starts once the Intake Agent has your language, framework and target URL.
          </div>
        )}

        {/* Intake output */}
        {show('intake') && request && (
          <section style={{ ...card, padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#f4f4f5' }}>Request (from Intake)</h3>
            <div style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.8 }}>
              <div><span style={{ color: '#52525b' }}>Stack:</span> {request.language} + {request.framework}</div>
              <div><span style={{ color: '#52525b' }}>Target:</span> <code style={{ color: '#c7d2fe' }}>{request.targetUrl}</code></div>
              <div><span style={{ color: '#52525b' }}>Focus:</span> {request.focus?.length ? request.focus.join(' · ') : 'none stated'}</div>
            </div>
          </section>
        )}

        {/* Test plan */}
        {show('planner') && testPlan && (
          <section style={{ ...card, padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13, color: '#f4f4f5' }}>Test Plan</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.5 }}>{testPlan.summary}</p>
            {testPlan.risks.length > 0 && (
              <div style={{ marginBottom: 14, fontSize: 12, color: '#71717a' }}>
                <b style={{ color: '#a1a1aa' }}>Risks:</b> {testPlan.risks.join(' · ')}
              </div>
            )}
            {testPlan.scenarios.map(s => {
              const editable = stage === 'plan_review';
              return (
                <div key={s.id} style={{ padding: '10px 0', borderTop: '1px solid rgba(255,255,255,.06)', opacity: included[s.id] ? 1 : 0.45 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" checked={!!included[s.id]} disabled={!editable} onChange={e => setIncluded(v => ({ ...v, [s.id]: e.target.checked }))} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: prioColor[s.priority] }}>{s.priority}</span>
                    <span style={{ fontSize: 11, color: '#52525b' }}>{s.id} · {s.type}</span>
                  </div>
                  <input
                    value={s.title}
                    readOnly={!editable}
                    onChange={e => editScenario(s.id, { title: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box', margin: '6px 0 4px', padding: '5px 8px', background: editable ? 'rgba(255,255,255,.04)' : 'transparent', border: editable ? '1px solid rgba(255,255,255,.08)' : '1px solid transparent', borderRadius: 5, color: '#e4e4e7', fontSize: 13, fontFamily: "'Inter', sans-serif", outline: 'none' }}
                  />
                  <div style={{ fontSize: 11.5, color: '#71717a', lineHeight: 1.5 }}>
                    {s.steps.map((st, i) => <div key={i}>{i + 1}. {st}</div>)}
                    <div style={{ color: '#4ade80', marginTop: 3 }}>Expect: {s.expected}</div>
                  </div>
                </div>
              );
            })}
            {stage === 'plan_review' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                <button onClick={runArchitect} disabled={nIncluded === 0} style={btn(true, nIncluded === 0)}>Approve plan ({nIncluded}) and design framework</button>
                <button onClick={() => runPlanner(request)} style={btn(false)}>Regenerate plan</button>
              </div>
            )}
          </section>
        )}

        {/* Architecture */}
        {show('architect') && architecture && (
          <section style={{ ...card, padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13, color: '#f4f4f5' }}>Framework Architecture</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.5 }}>{architecture.approach}</p>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#52525b', marginBottom: 6 }}>Files</div>
            {architecture.files.map((f, i) => (
              <div key={i} style={{ fontSize: 12, padding: '3px 0', display: 'flex', gap: 8 }}>
                <code style={{ color: '#c7d2fe', flexShrink: 0 }}>{f.path}{f.name}</code>
                <span style={{ color: '#52525b' }}>{f.purpose}</span>
              </div>
            ))}
            {architecture.pageObjects.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#52525b', margin: '14px 0 6px' }}>Page objects</div>
                {architecture.pageObjects.map((p, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '3px 0', color: '#a1a1aa' }}>
                    <b style={{ color: '#e4e4e7' }}>{p.name}</b> · {p.responsibilities}
                    {p.methods.length > 0 && <div style={{ color: '#52525b' }}>{p.methods.join(', ')}</div>}
                  </div>
                ))}
              </>
            )}
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#52525b', margin: '14px 0 6px' }}>Scenario to test mapping</div>
            {architecture.scenarioMap.map((m, i) => (
              <div key={i} style={{ fontSize: 12, padding: '2px 0', color: '#a1a1aa' }}>
                <span style={{ color: '#fbbf24' }}>{m.scenarioId}</span> → <code style={{ color: '#c7d2fe' }}>{m.testFile}</code> :: {m.testName}
              </div>
            ))}
            {stage === 'arch_review' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={runEngineer} style={btn(true)}>Approve architecture and write code</button>
                <button onClick={runArchitect} style={btn(false)}>Regenerate architecture</button>
                <button onClick={() => { setArchitecture(null); setStage('plan_review'); }} style={btn(false)}>Back to plan</button>
              </div>
            )}
          </section>
        )}

        {show('engineer') && stage === 'coding' && (
          <div style={{ ...card, padding: 20, color: '#a5b4fc', fontSize: 13 }}><Spinner /> Automation Engineer is writing the framework. This can take a minute or two.</div>
        )}

        {show('engineer') && stage === 'done' && result && (
          <section style={{ ...card, padding: 20, borderColor: 'rgba(74,222,128,.3)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 13, color: '#4ade80' }}>Framework generated: {result.files.length} files</h3>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#a1a1aa' }}>{result.summary}</p>
            {warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: '#fbbf24' }}>⚠ {w}</div>)}
            <button onClick={onOpenFiles} style={{ ...btn(true), marginTop: 12 }}>Open in File Explorer</button>
          </section>
        )}
      </div>
    </div>
  );
}
