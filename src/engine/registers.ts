import type { CpuState, Reg16, Reg8, RegName } from './types';

export const REG16: readonly Reg16[] = ['AX', 'BX', 'CX', 'DX', 'SI', 'DI', 'BP', 'SP'];
export const REG8: readonly Reg8[] = ['AL', 'AH', 'BL', 'BH', 'CL', 'CH', 'DL', 'DH'];

/** Segment registers exist on the 8086 but are not modelled by this simulator. */
export const SEGMENT_REGS = ['CS', 'DS', 'ES', 'SS'] as const;

export function isReg16(name: string): name is Reg16 {
  return (REG16 as readonly string[]).includes(name);
}

export function isReg8(name: string): name is Reg8 {
  return (REG8 as readonly string[]).includes(name);
}

export function regSize(reg: RegName): 8 | 16 {
  return isReg8(reg) ? 8 : 16;
}

/** AL/AH → AX etc. */
function parent(reg: Reg8): Reg16 {
  return (reg[0] + 'X') as Reg16;
}

export function getReg(cpu: CpuState, reg: RegName): number {
  if (isReg16(reg)) return cpu.regs[reg];
  const full = cpu.regs[parent(reg)];
  return reg[1] === 'H' ? (full >> 8) & 0xff : full & 0xff;
}

export function setReg(cpu: CpuState, reg: RegName, value: number): void {
  if (isReg16(reg)) {
    cpu.regs[reg] = value & 0xffff;
    return;
  }
  const p = parent(reg);
  const full = cpu.regs[p];
  const v = value & 0xff;
  cpu.regs[p] = reg[1] === 'H' ? (full & 0x00ff) | (v << 8) : (full & 0xff00) | v;
}

export function hex(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, '0') + 'h';
}
