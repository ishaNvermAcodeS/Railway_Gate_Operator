/**
 * 8086 Playground machine: the same CPU and execution core as Railway Lab,
 * attached to general-purpose virtual devices instead of the railway world.
 *
 *   OUT 10h, AL      character console (ASCII; 0Ah = new line)
 *   OUT 11h, AL/AX   print the value as an unsigned decimal number + new line
 *   OUT 12h, AL/AX   print the value as hex + new line
 *   OUT 20h, AL      8 LEDs
 *   IN  AL, 30h      8 toggle switches (set in the UI)
 *
 * Any other port is a plain latch: OUT stores a value, IN returns the last
 * value written there (00h if never written). Every access is logged.
 */
import { hex } from '../engine/registers';
import type { IoBus, Program, StepTrace } from '../engine/types';
import { Machine } from './machine';

export const PLAY_PORTS = { CHAR: 0x10, DEC: 0x11, HEX: 0x12, LEDS: 0x20, SWITCHES: 0x30 } as const;

export const PLAY_PORT_DOCS: { port: number; dir: 'OUT' | 'IN'; name: string; description: string }[] = [
  { port: PLAY_PORTS.CHAR, dir: 'OUT', name: 'CONSOLE', description: 'Write AL as an ASCII character. 0Ah starts a new line; 0Dh is ignored.' },
  { port: PLAY_PORTS.DEC, dir: 'OUT', name: 'PRINT DEC', description: 'Print AL (byte) or AX (word) as an unsigned decimal number, then a new line.' },
  { port: PLAY_PORTS.HEX, dir: 'OUT', name: 'PRINT HEX', description: 'Print AL or AX in hexadecimal, then a new line.' },
  { port: PLAY_PORTS.LEDS, dir: 'OUT', name: 'LEDS', description: 'Eight LEDs; bit n lights LED n.' },
  { port: PLAY_PORTS.SWITCHES, dir: 'IN', name: 'SWITCHES', description: 'Eight toggle switches you set in the I/O panel; bit n = switch n.' },
];

const OUTPUT_CAP = 20_000;

export interface PortRecord {
  port: number;
  dir: 'in' | 'out';
  value: number;
  size: 8 | 16;
  tick: number;
}

interface PlayDevice {
  output: string;
  ports: Record<number, PortRecord>;
}

export class PlaygroundMachine extends Machine<PlayDevice> {
  output = '';
  /** Last access per port, for the I/O table. */
  ports: Record<number, PortRecord> = {};
  /** Switch changes made by the user, by tick, so replay stays deterministic. */
  private switchLog: { tick: number; value: number }[];
  protected readonly bus: IoBus;

  constructor(program: Program, switches = 0) {
    super(program);
    this.switchLog = [{ tick: 0, value: switches & 0xff }];
    this.bus = {
      read: (port, size) => this.readPort(port, size),
      write: (port, value, size) => this.writePort(port, value, size),
    };
    this.init();
  }

  get finished(): boolean {
    return this.cpu.halted;
  }

  protected get haltMessage(): string {
    return `Program halted (HLT) after ${this.cpu.retired.toLocaleString()} instructions.`;
  }

  /** Switch bank value at the current tick. */
  get switches(): number {
    let v = 0;
    for (const e of this.switchLog) if (e.tick <= this.tick) v = e.value;
    return v;
  }

  /** Changes the switches from now on. Recorded so step-back and replay reproduce it. */
  setSwitches(value: number): void {
    this.switchLog = this.switchLog.filter((e) => e.tick < this.tick);
    this.switchLog.push({ tick: this.tick, value: value & 0xff });
    this.discardFuture();
    this.pushEvent({ tick: this.tick, kind: 'io-in', message: `Switches set to ${hex(value & 0xff, 2)}` });
  }

  get leds(): number {
    return this.ports[PLAY_PORTS.LEDS]?.value ?? 0;
  }

  private readPort(port: number, size: 8 | 16): number {
    if (port === PLAY_PORTS.SWITCHES) return this.switches;
    const last = this.ports[port];
    return last?.dir === 'out' ? last.value & (size === 8 ? 0xff : 0xffff) : 0;
  }

  private writePort(port: number, value: number, size: 8 | 16) {
    const v = value & (size === 8 ? 0xff : 0xffff);
    if (port === PLAY_PORTS.CHAR) {
      const c = v & 0xff;
      if (c !== 0x0d) this.print(c === 0x0a ? '\n' : String.fromCharCode(c));
    } else if (port === PLAY_PORTS.DEC) {
      this.print(`${v}\n`);
    } else if (port === PLAY_PORTS.HEX) {
      this.print(`${hex(v, size === 8 ? 2 : 4)}\n`);
    }
  }

  private print(text: string) {
    this.output += text;
    if (this.output.length > OUTPUT_CAP) this.output = this.output.slice(-OUTPUT_CAP);
  }

  protected afterStep(tick: number, trace: StepTrace | null): void {
    const io = trace?.io;
    if (!io || !trace) return;
    const ins = this.program.instructions[trace.index];
    const size = ins.operands.some((o) => o.kind === 'reg' && o.reg === 'AX') ? 16 : 8;
    const prev = this.ports[io.port];
    // A port that is only ever read keeps its last OUT value as the latch, so record reads separately.
    if (io.dir === 'out' || !prev || prev.dir === 'in') this.ports[io.port] = { port: io.port, dir: io.dir, value: io.value, size, tick };
    const isPrint = io.dir === 'out' && (io.port === PLAY_PORTS.CHAR || io.port === PLAY_PORTS.DEC || io.port === PLAY_PORTS.HEX);
    if (isPrint || !prev || prev.value !== io.value || prev.dir !== io.dir) {
      const v = hex(io.value, size === 8 ? 2 : 4);
      this.pushEvent({
        tick,
        kind: io.dir === 'out' ? 'io-out' : 'io-in',
        message: io.dir === 'out' ? `OUT ${hex(io.port, 2)} ← ${v}  (line ${trace.line})` : `IN ${hex(io.port, 2)} → ${v}  (line ${trace.line})`,
      });
    }
  }

  protected saveDevice(): PlayDevice {
    return { output: this.output, ports: structuredClone(this.ports) };
  }

  protected restoreDevice(d: PlayDevice): void {
    this.output = d.output;
    this.ports = structuredClone(d.ports);
  }
}
