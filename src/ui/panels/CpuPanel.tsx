import { useRef } from 'react';
import type { CpuState, Flags, Program, Reg16 } from '../../engine/types';

interface Props {
  cpu: CpuState | null;
  program: Program | null;
  tick: number;
}

const GENERAL: Reg16[] = ['AX', 'BX', 'CX', 'DX'];
const POINTER: Reg16[] = ['SI', 'DI', 'BP', 'SP'];
const FLAG_ORDER: (keyof Flags)[] = ['CF', 'ZF', 'SF', 'OF', 'PF', 'AF'];
const FLAG_NAMES: Record<keyof Flags, string> = {
  CF: 'Carry',
  ZF: 'Zero',
  SF: 'Sign',
  OF: 'Overflow',
  PF: 'Parity',
  AF: 'Aux carry',
};

const h = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, '0');

export function CpuPanel({ cpu, program, tick }: Props) {
  // Remember the values from the previously rendered tick to highlight changes.
  const prev = useRef<{ tick: number; regs: Record<string, number>; shown: Record<string, number> }>({ tick: -1, regs: {}, shown: {} });
  if (cpu && prev.current.tick !== tick) {
    prev.current = { tick, regs: prev.current.shown, shown: { ...cpu.regs, IP: cpu.ip } };
  }
  const changed = (name: string, value: number) => cpu !== null && prev.current.regs[name] !== undefined && prev.current.regs[name] !== value;

  const next = cpu && program ? program.instructions[cpu.ip] : undefined;

  return (
    <section className="panel cpu-panel" aria-label="CPU state">
      <header className="panel-head">
        <h2>CPU · 8086</h2>
        <span className={`cpu-state cpu-state--${cpu?.fault ? 'fault' : cpu?.halted ? 'halted' : cpu ? 'ok' : 'off'}`}>
          {cpu?.fault ? 'FAULT' : cpu?.halted ? 'HALTED' : cpu ? 'ACTIVE' : 'OFF'}
        </span>
      </header>

      <div className="next-instr" title="Instruction at CS:IP — executes on the next step">
        <span className="next-instr__k">NEXT</span>
        {next ? (
          <>
            <span className="next-instr__line">L{next.line}</span>
            <code>{next.text}</code>
          </>
        ) : (
          <code className="muted">{cpu?.halted ? 'HLT — no further instructions' : '—'}</code>
        )}
      </div>

      <div className="reg-grid">
        {GENERAL.map((r) => {
          const v = cpu?.regs[r] ?? 0;
          return (
            <div key={r} className={`reg ${changed(r, v) ? 'reg--changed' : ''}`} title={`${r} = ${v} (decimal)`}>
              <span className="reg__name">{r}</span>
              <span className="reg__val">
                <span className="reg__hi">{h(v >> 8, 2)}</span>
                <span className="reg__lo">{h(v & 0xff, 2)}</span>
              </span>
              <span className="reg__dec">{v}</span>
            </div>
          );
        })}
        {POINTER.map((r) => {
          const v = cpu?.regs[r] ?? 0;
          return (
            <div key={r} className={`reg ${changed(r, v) ? 'reg--changed' : ''}`} title={`${r} = ${v} (decimal)`}>
              <span className="reg__name">{r}</span>
              <span className="reg__val">{h(v, 4)}</span>
              <span className="reg__dec">{v}</span>
            </div>
          );
        })}
        <div className={`reg reg--ip ${cpu && changed('IP', cpu.ip) ? 'reg--changed' : ''}`} title="Instruction pointer: index of the next instruction">
          <span className="reg__name">IP</span>
          <span className="reg__val">{h(cpu?.ip ?? 0, 4)}</span>
          <span className="reg__dec">#{cpu?.ip ?? 0}</span>
        </div>
        <div className="reg reg--ip" title="Instructions retired since reset">
          <span className="reg__name">RET</span>
          <span className="reg__val">{(cpu?.retired ?? 0).toLocaleString()}</span>
          <span className="reg__dec">instr</span>
        </div>
      </div>

      <div className="flags">
        {FLAG_ORDER.map((f) => {
          const on = cpu?.flags[f] ?? false;
          return (
            <span key={f} className={`flag ${on ? 'flag--on' : ''}`} title={`${FLAG_NAMES[f]} flag = ${on ? 1 : 0}`}>
              {f}
              <b>{on ? 1 : 0}</b>
            </span>
          );
        })}
      </div>
    </section>
  );
}
