import { CONTROL_BITS, SENSOR_BITS, type BitDef } from '../../hardware/ports';
import type { Scenario } from '../../sim/scenarios';

interface Props {
  control: number;
  sensors: number;
  scenario: Scenario;
  timeMs: number;
}

const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
const b8 = (v: number) => v.toString(2).padStart(8, '0');

function PortRow({ title, dir, value, bits, tone, stuck }: { title: string; dir: 'OUT' | 'IN'; value: number; bits: BitDef[]; tone: 'out' | 'in'; stuck: Map<number, 0 | 1> }) {
  return (
    <div className="port">
      <div className="port__head">
        <span className={`port__dir port__dir--${tone}`}>{dir}</span>
        <span className="port__title">{title}</span>
        <span className="port__val">
          {h2(value)}h <span className="muted">{b8(value)}b</span>
        </span>
      </div>
      <div className="bits">
        {[...bits].reverse().map((b) => {
          const on = (value & (1 << b.bit)) !== 0;
          const reserved = b.label === '—';
          const s = stuck.get(b.bit);
          return (
            <div key={b.bit} className={`bit ${on ? `bit--on bit--${tone}` : ''} ${reserved ? 'bit--reserved' : ''} ${s !== undefined ? 'bit--stuck' : ''}`} title={`bit ${b.bit} · ${b.key}\n${b.description}${s !== undefined ? `\nFAULT INJECTED: stuck at ${s}` : ''}`}>
              <span className="bit__led" />
              <span className="bit__label">{b.label}</span>
              <span className="bit__n">{b.bit}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PortsPanel({ control, sensors, scenario, timeMs }: Props) {
  const stuck = new Map<number, 0 | 1>();
  for (const f of scenario.faults) if (f.kind === 'sensor-stuck' && timeMs >= f.fromMs) stuck.set(f.bit, f.value);
  return (
    <section className="panel ports-panel" aria-label="I/O ports">
      <header className="panel-head">
        <h2>Virtual I/O</h2>
      </header>
      <PortRow title="Port 02h · control latch" dir="OUT" value={control} bits={CONTROL_BITS} tone="out" stuck={new Map()} />
      <PortRow title="Port 03h · sensor inputs" dir="IN" value={sensors} bits={SENSOR_BITS} tone="in" stuck={stuck} />
    </section>
  );
}
