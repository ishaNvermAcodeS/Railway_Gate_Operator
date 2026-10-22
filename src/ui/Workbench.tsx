/**
 * Railway Lab workspace building blocks: top bar, execution controls,
 * editor pane, status bar and debugger shortcuts.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SampleProgram } from '../programs/samples';
import { AsmEditor, type LineState } from './editor/AsmEditor';
import { Icon } from './Icon';
import { ProblemsPanel } from './panels/ProblemsPanel';
import { SPEEDS, type RunState, type SimController } from './useSimController';

const RUN_STATE_LABEL: Record<RunState, string> = {
  edit: 'EDIT',
  ready: 'READY',
  running: 'RUNNING',
  paused: 'PAUSED',
  done: 'COMPLETE',
  fault: 'CPU FAULT',
};

/** Editor contents survive navigating to the home page and back (not page reloads). */
let draft: { source: string; sampleId: string } | null = null;

export function getDraft(fallback: SampleProgram) {
  return draft ?? { source: fallback.source, sampleId: fallback.id };
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="6" className="logo__bg" />
      <path d="M6 22 L26 10" stroke="#e8b45c" strokeWidth="4" strokeLinecap="round" />
      <path d="M6 22 L26 10" className="logo__dash" strokeWidth="4" strokeDasharray="3 4" />
      <circle cx="6" cy="22" r="3.2" fill="#e5534b" />
    </svg>
  );
}

export function TopBar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <header className="toolbar">
      <a className="brand" href="#/" title="Back to the home page">
        <Logo />
        <span className="brand__name">RailLogic</span>
      </a>
      {children}
      <div className="tb-spacer" />
      {right}
    </header>
  );
}

export function SampleSelect({ c, samples, sampleId, onSampleId }: { c: SimController; samples: SampleProgram[]; sampleId: string; onSampleId(id: string): void }) {
  return (
    <div className="tb-group">
      <label className="tb-field">
        <span>Program</span>
        <select
          value={sampleId}
          onChange={(e) => {
            const s = samples.find((x) => x.id === e.target.value)!;
            if (c.source !== samples.find((x) => x.id === sampleId)?.source && !confirm('Replace the editor contents with this sample? Your changes will be lost.')) return;
            onSampleId(s.id);
            c.loadSample(s.source);
          }}
          title={samples.find((x) => x.id === sampleId)?.description}
        >
          {samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function ExecControls({ c }: { c: SimController }) {
  const { actions, sim } = c;
  const errors = c.diagnostics.filter((d) => d.severity === 'error').length;
  const hasSession = sim !== null;
  return (
    <div className="tb-group tb-buttons" role="toolbar" aria-label="Execution controls">
      <button className="btn" onClick={actions.assemble} title="Assemble (Ctrl+Enter)">
        <Icon name="build" /> <span className="btn-label">Assemble</span>
      </button>
      <span className="tb-sep" />
      {c.running ? (
        <button className="btn btn--primary" onClick={actions.pause} title="Pause (F5)">
          <Icon name="pause" /> Pause
        </button>
      ) : (
        <button className="btn btn--primary" onClick={actions.run} disabled={errors > 0 && !hasSession} title="Run / continue (F5)">
          <Icon name="play" /> {c.runState === 'paused' ? 'Continue' : 'Run'}
        </button>
      )}
      <button className="btn btn--icon" onClick={actions.stepBack} disabled={!hasSession || sim!.tick === 0} title="Step back one instruction (Shift+F10)" aria-label="Step back">
        <Icon name="stepBack" />
      </button>
      <button className="btn btn--icon" onClick={actions.step} disabled={errors > 0 && !hasSession} title="Step one instruction (F10)" aria-label="Step">
        <Icon name="step" />
      </button>
      <button className="btn btn--icon" onClick={actions.reset} disabled={!hasSession} title="Reset to t = 0 (F8)" aria-label="Reset">
        <Icon name="reset" />
      </button>
      <button className="btn btn--icon" onClick={actions.stop} disabled={!hasSession} title="Stop and end the session (Shift+F5)" aria-label="Stop">
        <Icon name="stop" />
      </button>
    </div>
  );
}

export function SpeedSelect({ c, title }: { c: SimController; title: string }) {
  return (
    <label className="tb-field">
      <span>Clock</span>
      <select value={c.speedId} onChange={(e) => c.setSpeedId(e.target.value)} title={title}>
        {SPEEDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RunPill({ state }: { state: RunState }) {
  return (
    <div className={`run-pill run-pill--${state}`} aria-live="polite">
      <span className="run-pill__dot" />
      {RUN_STATE_LABEL[state]}
    </div>
  );
}

export type JumpTarget = { line: number; column: number; token: number } | null;

export function useJump() {
  const [jumpTo, setJumpTo] = useState<JumpTarget>(null);
  const jump = useCallback((line: number, column = 1) => setJumpTo({ line, column, token: Date.now() }), []);
  return { jumpTo, jump };
}

export function EditorPane({ c, jumpTo, onJump, fileName }: { c: SimController; jumpTo: JumpTarget; onJump(line: number, column?: number): void; fileName: string }) {
  const sim = c.sim;
  const lineState: LineState = c.runState === 'fault' ? 'fault' : c.running ? 'running' : 'paused';
  const currentLine = sim && !sim.cpu.halted ? sim.currentLine : null;
  return (
    <div className="pane pane--editor">
      <div className="pane-head">
        <span className="file-tab">
          {fileName}
          {c.stale && <span className="file-tab__dot" title="Modified since last assembly" />}
        </span>
        {c.stale && (
          <button className="link-btn" onClick={c.actions.assemble}>
            Source changed — assemble to apply
          </button>
        )}
        <span className="pane-head__spacer" />
        {c.breakpoints.size > 0 && (
          <button className="link-btn muted" onClick={c.clearBreakpoints} title="Remove all breakpoints">
            <span className="bp-dot" /> {c.breakpoints.size} breakpoint{c.breakpoints.size === 1 ? '' : 's'} · clear
          </button>
        )}
        <span className="pane-head__hint">Click the gutter or F9 for breakpoints</span>
      </div>
      <div className="editor-host">
        <AsmEditor
          value={c.source}
          onChange={c.setSource}
          diagnostics={c.diagnostics}
          currentLine={currentLine}
          lineState={lineState}
          breakpoints={c.breakpoints}
          onToggleBreakpoint={c.toggleBreakpoint}
          onBreakpointsMoved={c.moveBreakpoints}
          revealToken={c.revealToken}
          jumpTo={jumpTo}
        />
      </div>
      <ProblemsPanel diagnostics={c.diagnostics} onJump={onJump} />
    </div>
  );
}

export function StatusBar({ c }: { c: SimController }) {
  const sim = c.sim;
  const currentLine = sim && !sim.cpu.halted ? sim.currentLine : null;
  return (
    <footer className="statusbar">
      <span className={`statusbar__notice statusbar__notice--${c.notice?.tone ?? 'info'}`}>
        {c.notice?.text ?? (c.running ? 'Running…' : sim && sim.tick > 0 ? `Paused at tick ${sim.tick.toLocaleString()}` : 'Ready')}
      </span>
      <span className="statusbar__spacer" />
      {c.program && <span>{c.program.instructions.length} instructions</span>}
      {sim && (
        <>
          <span>
            tick {sim.tick.toLocaleString()} · t = {(sim.tick / 1000).toFixed(3)} s
          </span>
          <span>{currentLine !== null ? `line ${currentLine}` : sim.cpu.halted ? 'halted' : '—'}</span>
        </>
      )}
      <span className="statusbar__keys">F5 run/pause · F10 step · ⇧F10 back · F8 reset · ⇧F5 stop</span>
    </footer>
  );
}

/** First load: assemble the example so Run works immediately. Also wires debugger shortcuts. */
export function useWorkbench(c: SimController, sampleId: string) {
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    c.actions.assemble();
  }, [c.actions]);

  useEffect(() => {
    draft = { source: c.source, sampleId };
  }, [c.source, sampleId]);

  // Debugger keyboard shortcuts (captured before Monaco sees them).
  const latest = useRef(c);
  latest.current = c;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { actions: a, running } = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      let handled = true;
      if (e.key === 'F5' && e.shiftKey) a.stop();
      else if (e.key === 'F5') (running ? a.pause() : a.run());
      else if (e.key === 'F10' && e.shiftKey) a.stepBack();
      else if (e.key === 'F10') a.step();
      else if (e.key === 'F8') a.reset();
      else if (e.key === 'Enter' && mod) a.assemble();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

}
