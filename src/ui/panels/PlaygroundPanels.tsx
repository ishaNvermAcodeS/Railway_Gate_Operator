/**
 * Panels specific to the 8086 Playground: program output, general-purpose
 * devices (LEDs, switches, port table) and a memory view of DB/DW variables.
 * They reuse the Railway Lab panel, bit-LED and reference-table styles.
 */
import { useLayoutEffect, useRef } from 'react';
import { readMem } from '../../engine/instructions';
import { STACK_TOP } from '../../engine/cpu';
import type { CpuState, Program } from '../../engine/types';
import { PLAY_PORT_DOCS, PLAY_PORTS, type PlaygroundMachine } from '../../sim/playground';

const h = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, '0');

export function OutputPanel({ m, version }: { m: PlaygroundMachine | null; version: number }) {
  const ref = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [version]);
  const text = m?.output ?? '';
  return (
    <section className="panel output-panel" aria-label="Program output">
      <header className="panel-head">
        <h2>Program output</h2>
        <span className="muted mono">OUT 10h char · 11h dec · 12h hex</span>
      </header>
      <pre className="console" ref={ref} aria-live="polite">
        {text || <span className="console__empty">{m ? 'No output yet — run the program.' : 'Assemble a program to start.'}</span>}
        {m && !m.finished && text && <span className="console__cursor" />}
      </pre>
    </section>
  );
}

function BitRow({ label, value, tone, onToggle }: { label: string; value: number; tone: 'out' | 'in'; onToggle?: (bit: number) => void }) {
  return (
    <div className="bits">
      {[7, 6, 5, 4, 3, 2, 1, 0].map((b) => {
        const on = (value & (1 << b)) !== 0;
        const cls = `bit ${on ? `bit--on bit--${tone}` : ''} ${onToggle ? 'bit--switch' : ''}`;
        const content = (
          <>
            <span className="bit__led" />
            <span className="bit__label">{label}</span>
            <span className="bit__n">{b}</span>
          </>
        );
        return onToggle ? (
          <button key={b} className={cls} onClick={() => onToggle(b)} aria-pressed={on} title={`Switch ${b}: ${on ? 'on' : 'off'} (click to toggle)`}>
            {content}
          </button>
        ) : (
          <div key={b} className={cls} title={`LED ${b}: ${on ? 'on' : 'off'}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function DevicesPanel({ m, onToggleSwitch }: { m: PlaygroundMachine | null; onToggleSwitch(bit: number): void }) {
  const leds = m?.leds ?? 0;
  const sw = m?.switches ?? 0;
  const ports = m ? Object.values(m.ports).sort((a, b) => a.port - b.port) : [];
  return (
    <section className="panel ports-panel" aria-label="Virtual devices">
      <header className="panel-head">
        <h2>Devices &amp; I/O</h2>
      </header>
      <div className="port">
        <div className="port__head">
          <span className="port__dir port__dir--out">OUT</span>
          <span className="port__title">Port 20h · LEDs</span>
          <span className="port__val">{h(leds, 2)}h</span>
        </div>
        <BitRow label="LED" value={leds} tone="out" />
      </div>
      <div className="port">
        <div className="port__head">
          <span className="port__dir port__dir--in">IN</span>
          <span className="port__title">Port 30h · switches (click to toggle)</span>
          <span className="port__val">{h(sw, 2)}h</span>
        </div>
        <BitRow label="SW" value={sw} tone="in" onToggle={onToggleSwitch} />
      </div>
      <div className="port">
        <div className="port__head">
          <span className="port__title">Last access per port</span>
        </div>
        {ports.length === 0 ? (
          <p className="muted small">No IN/OUT executed yet.</p>
        ) : (
          <table className="ref-table io-table">
            <tbody>
              {ports.map((p) => (
                <tr key={p.port}>
                  <td className="mono strong">{h(p.port, 2)}h</td>
                  <td className="mono">{p.dir === 'out' ? 'OUT' : 'IN'}</td>
                  <td className="mono">{h(p.value, p.size === 8 ? 2 : 4)}h</td>
                  <td className="mono muted">{p.value}</td>
                  <td className="mono muted">t{p.tick}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function MemoryPanel({ cpu, program }: { cpu: CpuState | null; program: Program | null }) {
  const vars = program?.variables ?? [];
  const stackWords = cpu && cpu.regs.SP < STACK_TOP ? Math.min(6, (STACK_TOP - cpu.regs.SP) / 2) : 0;
  return (
    <section className="panel memory-panel" aria-label="Memory">
      <header className="panel-head">
        <h2>Memory</h2>
        <span className="muted mono">DB/DW from 0100h</span>
      </header>
      <div className="mem-list">
        {vars.length === 0 && <p className="muted small">No DB/DW variables. Declare data with e.g. ARR DB 1, 2, 3.</p>}
        {vars.map((v) => (
          <div className="mem-var" key={v.name}>
            <div className="mem-var__head">
              <span className="mono strong">{v.name}</span>
              <span className="mono muted">
                {h(v.address, 4)}h · {v.size === 8 ? 'DB' : 'DW'} × {v.count}
              </span>
            </div>
            <div className="mem-cells">
              {Array.from({ length: Math.min(v.count, 64) }, (_, i) => {
                const addr = v.address + (i * v.size) / 8;
                const val = cpu ? readMem(cpu, addr, v.size) : 0;
                const ch = v.size === 8 && val >= 32 && val < 127 ? ` '${String.fromCharCode(val)}'` : '';
                return (
                  <span key={i} className="mem-cell" title={`[${h(addr, 4)}h] = ${val}${ch}`}>
                    {h(val, v.size === 8 ? 2 : 4)}
                  </span>
                );
              })}
              {v.count > 64 && <span className="muted mono">+{v.count - 64}</span>}
            </div>
          </div>
        ))}
        {stackWords > 0 && cpu && (
          <div className="mem-var">
            <div className="mem-var__head">
              <span className="mono strong">STACK</span>
              <span className="mono muted">SP = {h(cpu.regs.SP, 4)}h (top first)</span>
            </div>
            <div className="mem-cells">
              {Array.from({ length: stackWords }, (_, i) => (
                <span key={i} className="mem-cell">
                  {h(readMem(cpu, cpu.regs.SP + i * 2, 16), 4)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function PlaygroundIoMap() {
  return (
    <div className="log-scroll ref">
      <div className="ref-block">
        <h3>8086 Playground ports</h3>
        <table className="ref-table">
          <tbody>
            {PLAY_PORT_DOCS.map((p) => (
              <tr key={p.port}>
                <td className="mono strong">{h(p.port, 2)}h</td>
                <td className="mono">{p.dir}</td>
                <td className="mono">{p.name}</td>
                <td>{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ref-note">
        Any other port is a plain latch: <code>OUT</code> stores a value and <code>IN</code> returns the last value written (00h if never written). For example{' '}
        <code>MOV AL, 'A'</code> + <code>OUT {h(PLAY_PORTS.CHAR, 2)}h, AL</code> prints “A”. One instruction executes per machine tick; a Run stops after 1,000,000
        instructions without <code>HLT</code>.
      </p>
    </div>
  );
}
