import { emptyFlags } from './flags';
import { INSTRUCTIONS, type ExecContext } from './instructions';
import { hex } from './registers';
import { AsmRuntimeError, type CpuState, type IoBus, type Program, type StepTrace } from './types';

export const STACK_TOP = 0xfffe;

/** Creates a reset CPU. When a program is given, its DB/DW data is loaded into memory. */
export function createCpu(program?: Program): CpuState {
  const memory: Record<number, number> = {};
  for (const [addr, byte] of program?.data ?? []) memory[addr] = byte;
  return {
    regs: { AX: 0, BX: 0, CX: 0, DX: 0, SI: 0, DI: 0, BP: 0, SP: STACK_TOP },
    ip: 0,
    flags: emptyFlags(),
    memory,
    halted: false,
    fault: null,
    retired: 0,
  };
}

export function cloneCpu(cpu: CpuState): CpuState {
  return {
    regs: { ...cpu.regs },
    ip: cpu.ip,
    flags: { ...cpu.flags },
    memory: { ...cpu.memory },
    halted: cpu.halted,
    fault: cpu.fault,
    retired: cpu.retired,
  };
}

/**
 * Executes exactly one instruction, mutating `cpu`.
 *
 * Returns a trace of what happened, or null if the CPU is halted or faulted.
 * Runtime faults (IP out of range, stack underflow) halt the CPU and set
 * `cpu.fault` — they are never silently ignored.
 */
export function step(cpu: CpuState, program: Program, bus: IoBus): StepTrace | null {
  if (cpu.halted || cpu.fault) return null;

  const instr = program.instructions[cpu.ip];
  if (!instr) {
    cpu.fault = `IP ${hex(cpu.ip, 4)} is outside the program (${program.instructions.length} instructions). Execution ran past the last instruction — end the program with JMP or HLT.`;
    return null;
  }

  const def = INSTRUCTIONS.get(instr.mnemonic);
  if (!def) {
    // Unreachable for programs produced by `assemble`, but never skip silently.
    cpu.fault = `Unsupported instruction ${instr.mnemonic} at line ${instr.line}`;
    return null;
  }

  const ctx: ExecContext = { cpu, bus, effects: [] };
  try {
    def.execute(ctx, instr);
  } catch (e) {
    if (e instanceof AsmRuntimeError) {
      cpu.fault = `Line ${instr.line}: ${e.message}`;
      return { index: instr.index, line: instr.line, text: instr.text, effects: [`FAULT: ${e.message}`] };
    }
    throw e;
  }

  cpu.ip = ctx.nextIp ?? instr.index + 1;
  cpu.retired++;
  return {
    index: instr.index,
    line: instr.line,
    text: instr.text,
    effects: ctx.effects,
    io: ctx.io,
    jumped: ctx.nextIp !== undefined,
  };
}

export type RunOutcome = 'halted' | 'fault' | 'budget';

/**
 * Headless run with an execution budget. Infinite loops such as `L: JMP L`
 * return `'budget'` after `maxInstructions` steps instead of hanging.
 */
export function run(cpu: CpuState, program: Program, bus: IoBus, maxInstructions: number): { outcome: RunOutcome; executed: number } {
  let executed = 0;
  while (executed < maxInstructions) {
    if (cpu.halted) return { outcome: 'halted', executed };
    if (cpu.fault) return { outcome: 'fault', executed };
    step(cpu, program, bus);
    if (!cpu.fault) executed++;
  }
  if (cpu.halted) return { outcome: 'halted', executed };
  if (cpu.fault) return { outcome: 'fault', executed };
  return { outcome: 'budget', executed };
}
