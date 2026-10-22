/**
 * Animated 8086 architecture diagram for the home page background, after the
 * classic Intel BIU/EU block diagram. The register file, IP, instruction queue
 * and flags show live values from the real Hex86 engine running a small
 * Fibonacci loop; data pulses travel along the buses.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { assemble } from '../engine/assembler';
import { createCpu, step } from '../engine/cpu';
import type { CpuState, IoBus, Program } from '../engine/types';

const DEMO = `START: MOV AX, 0
       MOV BX, 1
       MOV CX, 20
FIB:   MOV DX, AX
       ADD DX, BX
       MOV AX, BX
       MOV BX, DX
       LOOP FIB
       JMP START`;

const NO_IO: IoBus = { read: () => 0, write: () => {} };
const TICK_MS = 650;

const h = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, '0');

interface Snapshot {
  cpu: CpuState;
  changed: Set<string>;
  tick: number;
}

function snapshotRegs(cpu: CpuState): Record<string, number> {
  return { ...cpu.regs, IP: cpu.ip };
}

/** Runs the demo program one instruction per tick. Paused when motion is reduced. */
function useDemoCpu(): { program: Program; snap: Snapshot } {
  const program = useMemo(() => assemble(DEMO).program!, []);
  const cpuRef = useRef<CpuState>(createCpu(program));
  const [snap, setSnap] = useState<Snapshot>(() => ({ cpu: cpuRef.current, changed: new Set(), tick: 0 }));

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Pre-run a few instructions so the still image shows a meaningful state.
    for (let i = 0; i < 23; i++) step(cpuRef.current, program, NO_IO);
    setSnap({ cpu: { ...cpuRef.current, regs: { ...cpuRef.current.regs }, flags: { ...cpuRef.current.flags } }, changed: new Set(), tick: 0 });
    if (reduce) return;
    const id = setInterval(() => {
      const cpu = cpuRef.current;
      const before = snapshotRegs(cpu);
      step(cpu, program, NO_IO);
      const after = snapshotRegs(cpu);
      const changed = new Set(Object.keys(after).filter((k) => after[k] !== before[k]));
      setSnap((s) => ({ cpu: { ...cpu, regs: { ...cpu.regs }, flags: { ...cpu.flags } }, changed, tick: s.tick + 1 }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [program]);

  return { program, snap };
}

/** A data pulse travelling along a bus path. */
function Pulse({ path, dur, begin = '0s' }: { path: string; dur: string; begin?: string }) {
  return (
    <circle r="3.2" className="arch-pulse">
      <animateMotion path={path} dur={dur} begin={begin} repeatCount="indefinite" />
    </circle>
  );
}

function Bus({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} className="arch-bus" />
      <path d={d} className="arch-flow" />
      {label && (
        <text x={lx} y={ly} className="arch-label">
          {label}
        </text>
      )}
    </g>
  );
}

/** `fit`: 'meet' shows the whole diagram; 'slice' fills the area (cropping edges). */
export function ArchDiagram({ fit = 'slice' }: { fit?: 'meet' | 'slice' }) {
  const { program, snap } = useDemoCpu();
  const { cpu, changed, tick } = snap;
  const r = cpu.regs;
  const hot = (k: string) => (changed.has(k) ? 'arch-cell arch-cell--hot' : 'arch-cell');
  const queue = Array.from({ length: 6 }, (_, i) => program.instructions[(cpu.ip + i) % program.instructions.length]);
  const exec = program.instructions[(cpu.ip + program.instructions.length - 1) % program.instructions.length];

  const gen: [string, number, string, number, string][] = [
    ['AH', r.AX >> 8, 'AL', r.AX & 0xff, 'AX'],
    ['BH', r.BX >> 8, 'BL', r.BX & 0xff, 'BX'],
    ['CH', r.CX >> 8, 'CL', r.CX & 0xff, 'CX'],
    ['DH', r.DX >> 8, 'DL', r.DX & 0xff, 'DX'],
  ];
  const ptr: ['SP' | 'BP' | 'SI' | 'DI', number][] = [
    ['SP', r.SP],
    ['BP', r.BP],
    ['SI', r.SI],
    ['DI', r.DI],
  ];

  return (
    <svg className="arch" viewBox={fit === 'meet' ? '90 0 1080 790' : '-20 -40 1240 870'} preserveAspectRatio={`xMidYMid ${fit}`} aria-hidden="true">
      <defs>
        <pattern id="arch-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" className="arch-dot" />
        </pattern>
      </defs>
      <rect x="-20" y="-40" width="1240" height="870" fill="url(#arch-grid)" />

      {/* units */}
      <rect x="60" y="90" width="1080" height="280" rx="6" className="arch-unit" />
      <text x="80" y="116" className="arch-unit-label">BIU · BUS INTERFACE UNIT</text>
      <rect x="60" y="392" width="1080" height="380" rx="6" className="arch-unit" />
      <text x="80" y="418" className="arch-unit-label">EU · EXECUTION UNIT</text>

      {/* buses (drawn first, under the blocks) */}
      <Bus d="M230 64 V126" />
      <Bus d="M296 150 H330 V104 H945 V126" label="C-BUS" lx={600} ly={96} />
      <Bus d="M185 200 V178" label="B-BUS" lx={108} ly={192} />
      <Bus d="M945 310 V420" />
      <Bus d="M235 322 V520" />
      <Bus d="M100 480 H1000" label="A-BUS" lx={500} ly={472} />
      <Bus d="M960 476 V480" />
      <Bus d="M580 480 V530" />
      <Bus d="M760 480 V530" />
      <Bus d="M670 640 V690" />
      <Bus d="M780 715 H1060 V476" />

      {/* memory interface */}
      <rect x="130" y="20" width="200" height="44" rx="22" className="arch-block" />
      <text x="230" y="47" className="arch-title" textAnchor="middle">
        MEMORY INTERFACE
      </text>

      {/* address adder Σ */}
      <polygon points="168,126 296,126 274,176 190,176" className="arch-block arch-adder" />
      <text x="232" y="160" className="arch-sigma" textAnchor="middle">
        Σ
      </text>

      {/* segment registers + IP */}
      {(['ES', 'CS', 'SS', 'DS'] as const).map((s, i) => (
        <g key={s}>
          <rect x="150" y={200 + i * 24} width="170" height="24" className="arch-cell" />
          <text x="164" y={216 + i * 24} className="arch-reg">
            {s}
          </text>
        </g>
      ))}
      <rect x="150" y="296" width="170" height="26" className={hot('IP')} />
      <text x="164" y="313" className="arch-reg">
        IP
      </text>
      <text x="306" y="313" className="arch-val" textAnchor="end">
        {h(cpu.ip, 4)}
      </text>

      {/* instruction queue */}
      {queue.map((ins, i) => {
        // Slot 1 (bottom) is the next instruction to execute; keys follow the instruction so only new entries animate in.
        const y = 128 + (5 - i) * 30;
        return (
          <g key={`q${(cpu.ip + i) % program.instructions.length}`} className={i === 0 ? 'arch-q arch-q--next' : 'arch-q'}>
            <rect x="880" y={y} width="130" height="30" className="arch-cell" />
            <text x="892" y={y + 19} className="arch-qn">
              {i + 1}
            </text>
            <text x="910" y={y + 19} className="arch-qtext">
              {ins.text.replace(/\s+/g, ' ')}
            </text>
          </g>
        );
      })}
      <text x="1026" y="196" className="arch-label">
        INSTRUCTION
      </text>
      <text x="1026" y="212" className="arch-label">
        STREAM BYTE
      </text>
      <text x="1026" y="228" className="arch-label">
        QUEUE
      </text>

      {/* control system */}
      <rect x="860" y="420" width="200" height="56" rx="4" className="arch-block" />
      <text x="960" y="445" className="arch-title" textAnchor="middle">
        CONTROL SYSTEM
      </text>
      <text x="960" y="464" className="arch-exec" textAnchor="middle" key={`x${tick}`}>
        {exec.text.replace(/\s+/g, ' ')}
      </text>

      {/* general registers */}
      {gen.map(([hi, hv, lo, lv, full], i) => (
        <g key={full}>
          <rect x="150" y={520 + i * 26} width="85" height="26" className={hot(full)} />
          <rect x="235" y={520 + i * 26} width="85" height="26" className={hot(full)} />
          <text x="160" y={537 + i * 26} className="arch-reg">
            {hi}
          </text>
          <text x="226" y={537 + i * 26} className="arch-val" textAnchor="end">
            {h(hv, 2)}
          </text>
          <text x="245" y={537 + i * 26} className="arch-reg">
            {lo}
          </text>
          <text x="311" y={537 + i * 26} className="arch-val" textAnchor="end">
            {h(lv, 2)}
          </text>
        </g>
      ))}
      {ptr.map(([name, v], i) => (
        <g key={name}>
          <rect x="150" y={624 + i * 26} width="170" height="26" className={hot(name)} />
          <text x="160" y={641 + i * 26} className="arch-reg">
            {name}
          </text>
          <text x="311" y={641 + i * 26} className="arch-val" textAnchor="end">
            {h(v, 4)}
          </text>
        </g>
      ))}
      <Bus d="M320 600 H420 V480" />

      {/* ALU */}
      <polygon points="520,530 640,530 670,562 700,530 820,530 762,640 578,640" className="arch-block arch-alu" />
      <text x="670" y="596" className="arch-title" textAnchor="middle">
        ARITHMETIC
      </text>
      <text x="670" y="614" className="arch-title" textAnchor="middle">
        LOGIC UNIT
      </text>

      {/* operands / flags */}
      <rect x="560" y="690" width="220" height="50" rx="3" className="arch-block" />
      <line x1="560" x2="780" y1="712" y2="712" className="arch-bus" />
      <text x="670" y="705" className="arch-label" textAnchor="middle">
        OPERANDS
      </text>
      {(['CF', 'ZF', 'SF', 'OF', 'PF'] as const).map((f, i) => (
        <text key={f} x={588 + i * 41} y="731" className={cpu.flags[f] ? 'arch-flag arch-flag--on' : 'arch-flag'} textAnchor="middle">
          {f}
        </text>
      ))}

      {/* data pulses */}
      <Pulse path="M230 64 V126" dur="1.6s" />
      <Pulse path="M296 150 H330 V104 H945 V126" dur="3.2s" begin="0.4s" />
      <Pulse path="M945 310 V420" dur="1.4s" begin="1s" />
      <Pulse path="M960 476 V480 H580 V530" dur="2.4s" begin="0.2s" />
      <Pulse path="M320 600 H420 V480 H760 V530" dur="2.6s" begin="1.3s" />
      <Pulse path="M670 640 V690" dur="1.2s" begin="0.7s" />
      <Pulse path="M235 322 V520" dur="1.8s" begin="0.9s" />
    </svg>
  );
}
