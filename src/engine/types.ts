/**
 * Core types shared by the assembler and the CPU.
 *
 * The engine is deliberately independent of React, the DOM and the railway
 * simulation, so it can be unit-tested headlessly and reused for other
 * virtual hardware.
 */

export type Reg16 = 'AX' | 'BX' | 'CX' | 'DX' | 'SI' | 'DI' | 'BP' | 'SP';
export type Reg8 = 'AL' | 'AH' | 'BL' | 'BH' | 'CL' | 'CH' | 'DL' | 'DH';
export type RegName = Reg16 | Reg8;

export type BaseReg = 'BX' | 'BP';
export type IndexReg = 'SI' | 'DI';

export type Operand =
  | { kind: 'reg'; reg: RegName; size: 8 | 16 }
  | { kind: 'imm'; value: number; text: string }
  | { kind: 'label'; name: string; target: number }
  /** Memory operand: [base + index + disp]. `size` is null when it must be inferred from the other operand. */
  | { kind: 'mem'; base: BaseReg | null; index: IndexReg | null; disp: number; size: 8 | 16 | null; text: string };

/** A variable declared with DB / DW. */
export interface Variable {
  name: string;
  address: number;
  /** Element size in bits. */
  size: 8 | 16;
  /** Number of elements. */
  count: number;
  line: number;
}

/** One assembled instruction. `index` doubles as the IP value. */
export interface Instruction {
  index: number;
  mnemonic: string;
  operands: Operand[];
  /** 1-based source line. */
  line: number;
  /** Normalised source text, e.g. `OUT 02h, AL`. */
  text: string;
}

export interface SourceSpan {
  line: number;
  startColumn: number;
  endColumn: number;
}

export interface Diagnostic extends SourceSpan {
  severity: 'error' | 'warning';
  message: string;
}

export interface Program {
  instructions: Instruction[];
  labels: Map<string, number>;
  constants: Map<string, number>;
  /** Maps 1-based source line → instruction index (only for lines with code). */
  lineToIndex: Map<number, number>;
  /** Variables declared with DB/DW, in declaration order. */
  variables: Variable[];
  /** Initial memory image produced by DB/DW: [address, byte] pairs. */
  data: Array<[number, number]>;
}

export interface AssembleResult {
  program: Program | null;
  diagnostics: Diagnostic[];
}

export interface Flags {
  CF: boolean;
  PF: boolean;
  AF: boolean;
  ZF: boolean;
  SF: boolean;
  OF: boolean;
}

export interface CpuState {
  regs: Record<Reg16, number>;
  ip: number;
  flags: Flags;
  /** Sparse, flat 64 KB byte-addressed memory holding DB/DW data and the stack. Only written bytes are stored. */
  memory: Record<number, number>;
  halted: boolean;
  /** Set when the CPU stops because of a runtime fault. */
  fault: string | null;
  /** Total instructions retired since reset. */
  retired: number;
}

/** Port-mapped I/O bus implemented by whatever hardware is attached. */
export interface IoBus {
  read(port: number, size: 8 | 16): number;
  write(port: number, value: number, size: 8 | 16): void;
}

/** What happened during a single CPU step; used for the execution log. */
export interface StepTrace {
  index: number;
  line: number;
  text: string;
  /** Human-readable side effects, e.g. `AL ← 05h` or `port 02h ← 07h`. */
  effects: string[];
  io?: { dir: 'in' | 'out'; port: number; value: number };
  jumped?: boolean;
}

export class AsmRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsmRuntimeError';
  }
}
