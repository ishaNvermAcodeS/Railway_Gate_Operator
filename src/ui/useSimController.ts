import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assemble } from '../engine/assembler';
import type { Diagnostic, Program } from '../engine/types';
import { getScenario } from '../sim/scenarios';
import { Simulation, type StopReason } from '../sim/simulation';
import { createWorld } from '../sim/world';

export interface SpeedOption {
  id: string;
  label: string;
  /** Machine ticks (instructions) per real second. 1000 = real time. */
  tps: number;
}

export const SPEEDS: SpeedOption[] = [
  { id: '10hz', label: '10 Hz', tps: 10 },
  { id: '100hz', label: '100 Hz', tps: 100 },
  { id: '0.5x', label: '0.5×', tps: 500 },
  { id: '1x', label: '1× real time', tps: 1000 },
  { id: '2x', label: '2×', tps: 2000 },
  { id: '5x', label: '5×', tps: 5000 },
  { id: '20x', label: '20×', tps: 20000 },
];

/** Hard cap on instructions per animation frame, so the UI always stays responsive. */
const MAX_TICKS_PER_FRAME = 5000;

export type RunState = 'edit' | 'ready' | 'running' | 'paused' | 'done' | 'fault';

export interface Notice {
  tone: 'info' | 'warn' | 'error' | 'ok';
  text: string;
}

export function useSimController(initialSource: string, initialScenario: string) {
  const [source, setSourceState] = useState(initialSource);
  const [scenarioId, setScenarioId] = useState(initialScenario);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [assembledSource, setAssembledSource] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [speedId, setSpeedId] = useState('2x');
  const [breakpoints, setBreakpoints] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [, setFrame] = useState(0);
  const [revealToken, setRevealToken] = useState(0);

  const simRef = useRef<Simulation | null>(null);
  const rafRef = useRef<number | null>(null);
  const bpRef = useRef(breakpoints);
  bpRef.current = breakpoints;
  const speedRef = useRef(SPEEDS.find((s) => s.id === speedId)!.tps);
  speedRef.current = SPEEDS.find((s) => s.id === speedId)!.tps;

  const scenario = useMemo(() => getScenario(scenarioId), [scenarioId]);
  const bump = useCallback(() => setFrame((f) => f + 1), []);

  // Live diagnostics while typing (does not touch the running session).
  useEffect(() => {
    const t = setTimeout(() => setDiagnostics(assemble(source).diagnostics), 220);
    return () => clearTimeout(t);
  }, [source]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setRunning(false);
  }, []);

  const describeStop = useCallback((sim: Simulation, reason: StopReason): Notice => {
    switch (reason) {
      case 'breakpoint':
        return { tone: 'info', text: `Breakpoint hit at line ${sim.currentLine}` };
      case 'fault':
        return { tone: 'error', text: sim.cpu.fault ?? 'CPU fault' };
      case 'done': {
        const v = sim.world.stats.violations;
        return v === 0
          ? { tone: 'ok', text: `Scenario complete — no safety violations` }
          : { tone: 'error', text: `Scenario complete — ${v} safety violation${v === 1 ? '' : 's'}` };
      }
      default:
        return { tone: 'info', text: 'Paused' };
    }
  }, []);

  /** Assembles the current source and starts a fresh session. Returns the simulation or null. */
  const doAssemble = useCallback(
    (src = source, scen = scenarioId): Simulation | null => {
      stopLoop();
      const result = assemble(src);
      setDiagnostics(result.diagnostics);
      if (!result.program) {
        simRef.current = null;
        setAssembledSource(null);
        const n = result.diagnostics.filter((d) => d.severity === 'error').length;
        setNotice({ tone: 'error', text: `Assembly failed — ${n} error${n === 1 ? '' : 's'}. See Problems.` });
        bump();
        return null;
      }
      const sim = new Simulation(result.program, getScenario(scen));
      simRef.current = sim;
      setAssembledSource(src);
      setNotice({ tone: 'ok', text: `Assembled ${result.program.instructions.length} instructions, ${result.program.labels.size} labels` });
      setRevealToken((t) => t + 1);
      bump();
      return sim;
    },
    [source, scenarioId, stopLoop, bump],
  );

  const ensureSim = useCallback((): Simulation | null => {
    if (simRef.current && assembledSource !== null) return simRef.current;
    return doAssemble();
  }, [assembledSource, doAssemble]);

  const run = useCallback(() => {
    let sim = ensureSim();
    if (!sim) return;
    if (sim.finished || sim.cpu.fault) {
      sim.reset();
    }
    setNotice(null);
    setRunning(true);
    let last = performance.now();
    let acc = 0;
    let first = true;
    const frame = (now: number) => {
      sim = simRef.current;
      if (!sim) return stopLoop();
      const dt = Math.min(100, now - last);
      last = now;
      acc += (dt * speedRef.current) / 1000;
      let n = Math.min(MAX_TICKS_PER_FRAME, Math.floor(acc));
      acc -= Math.floor(acc);
      if (first) {
        n = Math.max(n, 1); // always make progress so "continue" leaves a breakpoint
        first = false;
      }
      if (n > 0) {
        const r = sim.runFor(n, bpRef.current);
        if (r.reason !== 'budget') {
          stopLoop();
          setNotice(describeStop(sim, r.reason));
          setRevealToken((t) => t + 1);
          bump();
          return;
        }
      }
      bump();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }, [ensureSim, stopLoop, describeStop, bump]);

  const pause = useCallback(() => {
    stopLoop();
    setNotice({ tone: 'info', text: 'Paused' });
    setRevealToken((t) => t + 1);
  }, [stopLoop]);

  const step = useCallback(() => {
    stopLoop();
    const sim = ensureSim();
    if (!sim) return;
    if (!sim.stepTick()) {
      setNotice(describeStop(sim, 'done'));
    } else if (sim.cpu.fault) {
      setNotice(describeStop(sim, 'fault'));
    } else {
      setNotice(null);
    }
    setRevealToken((t) => t + 1);
    bump();
  }, [stopLoop, ensureSim, describeStop, bump]);

  const stepBack = useCallback(() => {
    stopLoop();
    const sim = simRef.current;
    if (!sim) return;
    if (!sim.stepBack()) setNotice({ tone: 'info', text: 'Already at t = 0' });
    else setNotice(null);
    setRevealToken((t) => t + 1);
    bump();
  }, [stopLoop, bump]);

  const seek = useCallback(
    (tick: number) => {
      stopLoop();
      const sim = simRef.current;
      if (!sim) return;
      sim.seek(tick);
      setNotice({ tone: 'info', text: `Replayed to t = ${(sim.tick / 1000).toFixed(3)} s` });
      setRevealToken((t) => t + 1);
      bump();
    },
    [stopLoop, bump],
  );

  /** Rewind to t = 0, keeping the recorded timeline for replay. */
  const reset = useCallback(() => {
    stopLoop();
    const sim = simRef.current;
    if (!sim) return;
    sim.reset();
    setNotice({ tone: 'info', text: 'Reset to t = 0 — the recorded timeline can be replayed with the scrubber' });
    setRevealToken((t) => t + 1);
    bump();
  }, [stopLoop, bump]);

  /** End the session entirely. */
  const stop = useCallback(() => {
    stopLoop();
    simRef.current = null;
    setAssembledSource(null);
    setNotice({ tone: 'info', text: 'Stopped' });
    bump();
  }, [stopLoop, bump]);

  const selectScenario = useCallback(
    (id: string) => {
      setScenarioId(id);
      if (simRef.current && assembledSource !== null) {
        stopLoop();
        simRef.current = new Simulation(simRef.current.program, getScenario(id));
        setNotice({ tone: 'info', text: `Scenario: ${getScenario(id).name}` });
        bump();
      }
    },
    [assembledSource, stopLoop, bump],
  );

  const setSource = useCallback((s: string) => setSourceState(s), []);

  const loadSample = useCallback(
    (src: string) => {
      setBreakpoints(new Set());
      setSourceState(src);
      doAssemble(src);
    },
    [doAssemble],
  );

  const toggleBreakpoint = useCallback((line: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  const clearBreakpoints = useCallback(() => setBreakpoints(new Set()), []);
  const moveBreakpoints = useCallback((lines: number[]) => setBreakpoints(new Set(lines)), []);

  useEffect(() => () => stopLoop(), [stopLoop]);

  const sim = simRef.current;
  const program: Program | null = sim?.program ?? null;
  const stale = assembledSource !== null && assembledSource !== source;

  let runState: RunState = 'edit';
  if (sim) {
    if (running) runState = 'running';
    else if (sim.cpu.fault) runState = 'fault';
    else if (sim.finished) runState = 'done';
    else if (sim.tick === 0) runState = 'ready';
    else runState = 'paused';
  }

  // An idle world for the simulator view when no program is loaded.
  const idleWorld = useMemo(() => createWorld(scenario), [scenario]);

  return {
    source,
    setSource,
    loadSample,
    diagnostics,
    scenario,
    scenarioId,
    selectScenario,
    sim,
    program,
    world: sim?.world ?? idleWorld,
    stale,
    runState,
    running,
    notice,
    speedId,
    setSpeedId,
    breakpoints,
    toggleBreakpoint,
    clearBreakpoints,
    moveBreakpoints,
    revealToken,
    actions: { assemble: () => doAssemble(), run, pause, step, stepBack, seek, reset, stop },
  };
}

export type SimController = ReturnType<typeof useSimController>;
