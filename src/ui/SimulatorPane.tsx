import { decodeControl } from '../hardware/ports';
import type { Scenario } from '../sim/scenarios';
import type { Simulation } from '../sim/simulation';
import type { WorldState } from '../sim/world';
import { CrossingView } from './CrossingView';
import type { RunState } from './useSimController';

interface Props {
  sim: Simulation | null;
  world: WorldState;
  scenario: Scenario;
  runState: RunState;
  onSeek(tick: number): void;
}

function gateState(world: WorldState, control: number, jammed: boolean): { text: string; tone: string } {
  if (jammed && world.gatePos <= 0 && decodeControl(control).gateDown) return { text: 'JAMMED', tone: 'bad' };
  if (world.gatePos >= 1) return { text: 'DOWN', tone: 'warn' };
  if (world.gatePos <= 0) return { text: 'UP', tone: 'ok' };
  return decodeControl(control).gateDown ? { text: 'LOWERING', tone: 'warn' } : { text: 'RAISING', tone: 'warn' };
}

function Chip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`chip chip--${tone}`}>
      <span className="chip__k">{label}</span>
      <span className="chip__v">{value}</span>
    </div>
  );
}

function Timeline({ sim, scenario, onSeek }: { sim: Simulation; scenario: Scenario; onSeek(t: number): void }) {
  const max = scenario.durationMs;
  const pct = (t: number) => `${Math.min(100, (t / max) * 100)}%`;
  const marks = sim.eventLog.filter((e) => e.kind === 'violation' || (e.kind === 'train' && /reached the crossing|is clear/.test(e.message)));
  return (
    <div className="timeline">
      <span className="timeline__t">{(sim.tick / 1000).toFixed(2)} s</span>
      <div className="timeline__track">
        <div className="timeline__rec" style={{ width: pct(sim.maxTick) }} />
        {marks.map((m, i) => (
          <span key={i} className={`timeline__mark timeline__mark--${m.kind}`} style={{ left: pct(m.tick) }} title={`${(m.tick / 1000).toFixed(2)} s — ${m.message}`} />
        ))}
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(sim.tick, max)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Simulation timeline — drag to replay deterministically"
        />
      </div>
      <span className="timeline__t muted">{(max / 1000).toFixed(0)} s</span>
    </div>
  );
}

export function SimulatorPane({ sim, world, scenario, runState, onSeek }: Props) {
  const control = sim?.control ?? 0;
  const sensors = sim ? sim.sensors : 0x40;
  const out = decodeControl(control);
  const jammed = scenario.faults.some((f) => f.kind === 'gate-jam' && world.timeMs >= f.fromMs);
  const gate = gateState(world, control, jammed);
  const st = world.stats;
  const lastViolation = sim?.eventLog.filter((e) => e.kind === 'violation').at(-1);
  const recentViolation = lastViolation && world.timeMs - lastViolation.tick < 4000;

  return (
    <div className="sim-pane">
      <div className="sim-head">
        <div className="sim-head__title">
          <h2>{scenario.name}</h2>
          <p>{scenario.summary}</p>
        </div>
        <div className="sim-head__chips">
          <Chip label="GATE" value={gate.text} tone={gate.tone} />
          <Chip label="LAMPS" value={out.lights ? 'FLASH' : 'OFF'} tone={out.lights ? 'alert' : 'off'} />
          <Chip label="BUZZER" value={out.buzzer ? 'ON' : 'OFF'} tone={out.buzzer ? 'alert' : 'off'} />
          <Chip label="FAULT" value={out.fault ? 'LIT' : 'OFF'} tone={out.fault ? 'bad' : 'off'} />
        </div>
      </div>

      <div className={`sim-canvas ${recentViolation ? 'sim-canvas--alarm' : ''}`}>
        <CrossingView world={world} control={control} sensors={sensors} scenario={scenario} />
        {recentViolation && <div className="alarm-banner">{lastViolation!.message}</div>}
        {runState === 'ready' && (
          <div className="hint">
            <b>Ready.</b> Press <kbd>F5</kbd> Run, or <kbd>F10</kbd> to execute one instruction at a time.
          </div>
        )}
        {runState === 'edit' && !sim && (
          <div className="hint hint--muted">
            No program loaded. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to assemble.
          </div>
        )}
        <div className="safety">
          <div className={`safety__item ${st.violations ? 'safety__item--bad' : 'safety__item--ok'}`}>
            <span>Violations</span>
            <b>{st.violations}</b>
          </div>
          <div className="safety__item">
            <span>Min warning</span>
            <b>{st.minWarningMs === null ? '—' : `${(st.minWarningMs / 1000).toFixed(1)} s`}</b>
          </div>
          <div className="safety__item">
            <span>Trains cleared</span>
            <b>
              {st.trainsCleared}/{scenario.trains.length}
            </b>
          </div>
          <div className="safety__item">
            <span>Max road wait</span>
            <b>{(st.maxVehicleWaitMs / 1000).toFixed(1)} s</b>
          </div>
          <div className="safety__item">
            <span>Sim time</span>
            <b>{(world.timeMs / 1000).toFixed(2)} s</b>
          </div>
        </div>
      </div>

      {sim ? <Timeline sim={sim} scenario={scenario} onSeek={onSeek} /> : <div className="timeline timeline--off">Timeline available after assembly</div>}
    </div>
  );
}
