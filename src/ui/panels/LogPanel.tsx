import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { INSTRUCTIONS, type InstructionGroup } from '../../engine/instructions';
import { CONTROL_BITS, SENSOR_BITS } from '../../hardware/ports';
import type { EventLogEntry, ExecLogEntry } from '../../sim/simulation';

type Tab = 'events' | 'trace' | 'io' | 'isa';

interface Props {
  events: EventLogEntry[];
  trace: ExecLogEntry[];
  /** Changes whenever the logs may have changed. */
  version: number;
  onJumpToLine(line: number): void;
  /** Replaces the railway port reference in the "I/O map" tab. */
  ioMap?: ReactNode;
}

const KIND_LABEL: Record<EventLogEntry['kind'], string> = {
  info: 'INFO',
  train: 'TRAIN',
  gate: 'GATE',
  warning: 'WARN',
  violation: 'UNSAFE',
  'io-out': 'OUT',
  'io-in': 'IN',
  cpu: 'CPU',
  bus: 'BUS',
};

const secs = (tick: number) => (tick / 1000).toFixed(3);

function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  return { ref, onScroll };
}

function EventsView({ events, version, filter }: { events: EventLogEntry[]; version: number; filter: 'all' | 'io' | 'world' }) {
  const { ref, onScroll } = useStickToBottom(version);
  const shown = events.filter((e) => (filter === 'all' ? true : filter === 'io' ? e.kind === 'io-in' || e.kind === 'io-out' || e.kind === 'bus' : !(e.kind === 'io-in' || e.kind === 'io-out'))).slice(-400);
  return (
    <div className="log-scroll" ref={ref} onScroll={onScroll}>
      {shown.length === 0 && <div className="log-empty">No events yet. Run or step the program.</div>}
      {shown.map((e, i) => (
        <div key={`${e.tick}-${i}`} className={`log-row log-row--${e.kind}`}>
          <span className="log-t">{secs(e.tick)}</span>
          <span className={`log-kind log-kind--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
          <span className="log-msg">{e.message}</span>
        </div>
      ))}
    </div>
  );
}

function TraceView({ trace, version, onJumpToLine }: { trace: ExecLogEntry[]; version: number; onJumpToLine(line: number): void }) {
  const { ref, onScroll } = useStickToBottom(version);
  return (
    <div className="log-scroll" ref={ref} onScroll={onScroll}>
      {trace.length === 0 && <div className="log-empty">The instruction trace shows the last 400 executed instructions.</div>}
      {trace.map((e) => (
        <div key={e.tick} className="log-row trace-row" onClick={() => onJumpToLine(e.line)} title="Click to show in editor">
          <span className="log-t">{e.tick}</span>
          <span className="trace-ip">{e.ip.toString(16).toUpperCase().padStart(4, '0')}</span>
          <span className="trace-line">L{e.line}</span>
          <code className="trace-text">{e.text}</code>
          <span className="trace-fx">{e.effects}</span>
        </div>
      ))}
    </div>
  );
}

function IoMapView() {
  const table = (title: string, bits: typeof CONTROL_BITS) => (
    <div className="ref-block">
      <h3>{title}</h3>
      <table className="ref-table">
        <tbody>
          {bits.map((b) => (
            <tr key={b.bit}>
              <td className="mono">b{b.bit}</td>
              <td className="mono">{(1 << b.bit).toString(16).toUpperCase().padStart(2, '0')}h</td>
              <td className="mono strong">{b.key}</td>
              <td>{b.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="log-scroll ref">
      {table('Port 02h — OUT — control latch', CONTROL_BITS)}
      {table('Port 03h — IN — sensor inputs', SENSOR_BITS)}
      <p className="ref-note">
        All bits are active-high. One instruction executes per 1 ms machine tick, so <code>MOV CX, 1000</code> + <code>L: LOOP L</code> waits about one second. Reading
        port 02h returns the latch; other ports are unmapped (reads return FFh, writes are logged and ignored). The Events tab records I/O
        values when they change; the Trace tab shows every executed IN and OUT.
      </p>
    </div>
  );
}

function IsaView() {
  const groups = new Map<InstructionGroup, typeof defs>();
  const defs = [...INSTRUCTIONS.values()];
  for (const d of defs) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d);
  }
  return (
    <div className="log-scroll ref">
      {[...groups].map(([g, list]) => (
        <div className="ref-block" key={g}>
          <h3>{g}</h3>
          <table className="ref-table">
            <tbody>
              {list.map((d) => (
                <tr key={d.mnemonic}>
                  <td className="mono strong">{d.mnemonic}</td>
                  <td className="mono">{d.syntax.join(' · ')}</td>
                  <td>{d.summary}</td>
                  <td className="mono muted">{d.flags}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="ref-note">
        Operands: 8/16-bit registers, immediates (<code>25</code>, <code>0FFh</code>, <code>0x1F</code>, <code>1010b</code>, <code>'A'</code>), labels and <code>NAME EQU value</code>{' '}
        constants, <code>DB</code>/<code>DW</code> data and memory operands (<code>[BX+SI+2]</code>, <code>ARR[SI]</code>, <code>BYTE PTR [DI]</code>). Segment registers and
        other assembler directives are rejected with an error.
      </p>
    </div>
  );
}

export function LogPanel({ events, trace, version, onJumpToLine, ioMap }: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('hex86.logTab') as Tab) || 'events';
    } catch {
      return 'events';
    }
  });
  const [filter, setFilter] = useState<'all' | 'io' | 'world'>('all');
  useEffect(() => {
    try {
      localStorage.setItem('hex86.logTab', tab);
    } catch {
      /* storage unavailable */
    }
  }, [tab]);

  const tabs: [Tab, string][] = [
    ['events', 'Events'],
    ['trace', 'Trace'],
    ['io', 'I/O map'],
    ['isa', 'Instructions'],
  ];

  return (
    <section className="panel log-panel" aria-label="Execution log and reference">
      <header className="panel-head panel-head--tabs">
        <div className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'tab--on' : ''}`} onClick={() => setTab(id)}>
              {label}
              {id === 'events' && events.some((e) => e.kind === 'violation') && <span className="tab-dot" />}
            </button>
          ))}
        </div>
        {tab === 'events' && (
          <div className="seg seg--small">
            {(['all', 'world', 'io'] as const).map((f) => (
              <button key={f} className={filter === f ? 'seg--on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'world' ? 'World' : 'I/O'}
              </button>
            ))}
          </div>
        )}
      </header>
      {tab === 'events' && <EventsView events={events} version={version} filter={filter} />}
      {tab === 'trace' && <TraceView trace={trace} version={version} onJumpToLine={onJumpToLine} />}
      {tab === 'io' && (ioMap ?? <IoMapView />)}
      {tab === 'isa' && <IsaView />}
    </section>
  );
}
