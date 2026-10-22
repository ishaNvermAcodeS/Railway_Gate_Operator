/**
 * Generic execution core: a CPU attached to some
 * virtual hardware, advanced one instruction per tick, with checkpoints for
 * deterministic step-back / seek, breakpoints and bounded logs.
 *
 * Subclasses supply the hardware: an I/O bus, what happens after each
 * instruction, and how to snapshot/restore their own device state.
 */
import { cloneCpu, createCpu, step } from '../engine/cpu';
import type { CpuState, IoBus, Program, StepTrace } from '../engine/types';

const CHECKPOINT_INTERVAL = 1000;
const EXEC_LOG_CAP = 400;
const EVENT_LOG_CAP = 1500;

export interface ExecLogEntry {
  tick: number;
  line: number;
  ip: number;
  text: string;
  effects: string;
}

export type EventLogKind = 'info' | 'train' | 'gate' | 'warning' | 'violation' | 'io-out' | 'io-in' | 'cpu' | 'bus';

export interface EventLogEntry {
  tick: number;
  kind: EventLogKind;
  message: string;
}

export type StopReason = 'budget' | 'breakpoint' | 'done' | 'fault';

interface Snapshot<D> {
  tick: number;
  cpu: CpuState;
  device: D;
}

export abstract class Machine<D = unknown> {
  readonly program: Program;
  tick = 0;
  cpu: CpuState;
  /** The highest tick ever reached in this session (for the timeline). */
  maxTick = 0;
  execLog: ExecLogEntry[] = [];
  eventLog: EventLogEntry[] = [];

  private checkpoints = new Map<number, Snapshot<D>>();
  protected abstract readonly bus: IoBus;

  constructor(program: Program) {
    this.program = program;
    this.cpu = createCpu(program);
  }

  /** Call at the end of the subclass constructor, once device state exists. */
  protected init(): void {
    this.saveCheckpoint();
  }

  /** True when nothing more can happen (scenario over, program halted…). */
  abstract get finished(): boolean;
  /** Clone of the device state for checkpoints. */
  protected abstract saveDevice(): D;
  protected abstract restoreDevice(d: D): void;
  /** Called after every executed instruction (trace is null when the CPU is halted/faulted). */
  protected abstract afterStep(tick: number, trace: StepTrace | null): void;

  /** Advance one machine tick. Returns false if nothing could advance. */
  stepTick(): boolean {
    if (this.finished) return false;
    const tick = this.tick;
    const wasRunning = !this.cpu.halted && !this.cpu.fault;

    const trace = step(this.cpu, this.program, this.bus);
    if (trace) this.pushExec({ tick, line: trace.line, ip: trace.index, text: trace.text, effects: trace.effects.join('  ') });
    this.afterStep(tick, trace);
    if (wasRunning && this.cpu.halted) this.pushEvent({ tick, kind: 'cpu', message: this.haltMessage });
    if (wasRunning && this.cpu.fault) this.pushEvent({ tick, kind: 'cpu', message: `CPU fault: ${this.cpu.fault}` });

    this.tick++;
    if (this.tick > this.maxTick) this.maxTick = this.tick;
    if (this.tick % CHECKPOINT_INTERVAL === 0 && !this.checkpoints.has(this.tick)) this.saveCheckpoint();
    return true;
  }

  protected get haltMessage(): string {
    return 'CPU halted (HLT).';
  }

  /**
   * Runs up to `budget` ticks. Stops early on a breakpoint line (checked
   * before executing the instruction at that line, except on the first tick
   * so that "continue" can leave a breakpoint), a CPU fault, or when finished.
   */
  runFor(budget: number, breakpoints?: ReadonlySet<number>): { executed: number; reason: StopReason } {
    let executed = 0;
    while (executed < budget) {
      if (this.finished) return { executed, reason: 'done' };
      if (this.cpu.fault) return { executed, reason: 'fault' };
      if (executed > 0 && breakpoints && breakpoints.size > 0 && !this.cpu.halted) {
        const line = this.currentLine;
        if (line !== null && breakpoints.has(line)) return { executed, reason: 'breakpoint' };
      }
      this.stepTick();
      executed++;
    }
    if (this.finished) return { executed, reason: 'done' };
    if (this.cpu.fault) return { executed, reason: 'fault' };
    return { executed, reason: 'budget' };
  }

  /** Source line of the instruction about to execute. */
  get currentLine(): number | null {
    return this.program.instructions[this.cpu.ip]?.line ?? null;
  }

  // ───────────── deterministic replay

  private saveCheckpoint() {
    this.checkpoints.set(this.tick, { tick: this.tick, cpu: cloneCpu(this.cpu), device: this.saveDevice() });
  }

  private restore(s: Snapshot<D>) {
    this.tick = s.tick;
    this.cpu = cloneCpu(s.cpu);
    this.restoreDevice(s.device);
    this.execLog = this.execLog.filter((e) => e.tick < s.tick);
    this.eventLog = this.eventLog.filter((e) => e.tick < s.tick);
  }

  /** Moves to an exact tick by restoring the nearest earlier checkpoint and replaying. */
  seek(target: number): void {
    const t = Math.max(0, Math.floor(target));
    if (t === this.tick) return;
    if (t < this.tick) {
      let best = 0;
      for (const k of this.checkpoints.keys()) if (k <= t && k > best) best = k;
      this.restore(this.checkpoints.get(best)!);
    }
    while (this.tick < t && this.stepTick()) {
      /* replay */
    }
  }

  stepBack(): boolean {
    if (this.tick === 0) return false;
    this.seek(this.tick - 1);
    return true;
  }

  reset(): void {
    this.seek(0);
  }


  // ───────────── logs

  protected pushExec(e: ExecLogEntry) {
    this.execLog.push(e);
    if (this.execLog.length > EXEC_LOG_CAP) this.execLog.splice(0, this.execLog.length - EXEC_LOG_CAP);
  }

  protected pushEvent(e: EventLogEntry) {
    this.eventLog.push(e);
    if (this.eventLog.length > EVENT_LOG_CAP) this.eventLog.splice(0, this.eventLog.length - EVENT_LOG_CAP);
  }
}
