/**
 * Railway Lab machine: CPU + virtual I/O bus + railway world, advanced in lock-step.
 *
 * One machine tick executes one instruction and then advances the world by
 * MS_PER_TICK of simulated time. Because the CPU, the world and the scenarios
 * are all deterministic, any tick can be reproduced exactly: step-back and
 * timeline seeking restore the nearest checkpoint and replay forward (see Machine).
 */
import { hex } from '../engine/registers';
import type { IoBus, Program, StepTrace } from '../engine/types';
import { CONTROL_PORT, SENSOR_PORT } from '../hardware/ports';
import { Machine } from './machine';
import type { Scenario } from './scenarios';
import { createWorld, readSensorPort, stepWorld, type WorldState } from './world';

export type { EventLogEntry, EventLogKind, ExecLogEntry, StopReason } from './machine';

/** Simulated time per executed instruction (the "machine tick"). */
export const MS_PER_TICK = 1;

interface RailDevice {
  world: WorldState;
  control: number;
  lastSensorRead: number | null;
}

export class Simulation extends Machine<RailDevice> {
  readonly scenario: Scenario;
  world: WorldState;
  /** Port 02h output latch. */
  control = 0;
  /** Last value returned by IN on port 03h. The event log records I/O changes only; the trace shows every access. */
  private lastSensorRead: number | null = null;
  private controlBefore = 0;
  private pendingBus: { message: string }[] = [];
  protected readonly bus: IoBus;

  constructor(program: Program, scenario: Scenario) {
    super(program);
    this.scenario = scenario;
    this.world = createWorld(scenario);
    this.bus = {
      read: (port, size) => {
        const lo = this.readPort(port);
        return size === 8 ? lo : lo | (this.readPort(port + 1) << 8);
      },
      write: (port, value, size) => {
        this.writePort(port, value & 0xff);
        if (size === 16) this.writePort(port + 1, (value >> 8) & 0xff);
      },
    };
    this.init();
  }

  // ───────────── virtual I/O

  /** The sensor byte as currently presented on port 03h. */
  get sensors(): number {
    return readSensorPort(this.world, this.scenario);
  }

  private readPort(port: number): number {
    if (port === SENSOR_PORT) return this.sensors;
    if (port === CONTROL_PORT) return this.control;
    this.pendingBus.push({ message: `IN from unmapped port ${hex(port, 2)} — bus reads FFh` });
    return 0xff;
  }

  private writePort(port: number, value: number) {
    if (port === CONTROL_PORT) {
      this.control = value;
      return;
    }
    if (port === SENSOR_PORT) {
      this.pendingBus.push({ message: `OUT to port 03h ignored — the sensor port is read-only` });
      return;
    }
    this.pendingBus.push({ message: `OUT ${hex(value, 2)} to unmapped port ${hex(port, 2)} ignored` });
  }

  // ───────────── Machine hooks

  get timeMs(): number {
    return this.world.timeMs;
  }

  get finished(): boolean {
    return this.world.done;
  }

  protected get haltMessage(): string {
    return 'CPU halted (HLT). The world keeps running.';
  }

  override stepTick(): boolean {
    this.controlBefore = this.control;
    return super.stepTick();
  }

  protected afterStep(tick: number, trace: StepTrace | null): void {
    if (trace?.io?.dir === 'out' && trace.io.port === CONTROL_PORT) {
      if (this.control !== this.controlBefore) {
        this.pushEvent({ tick, kind: 'io-out', message: `OUT 02h ← ${hex(this.control, 2)}  (line ${trace.line})` });
      }
    } else if (trace?.io?.dir === 'in' && trace.io.port === SENSOR_PORT) {
      const v = trace.io.value & 0xff;
      if (v !== this.lastSensorRead) {
        this.pushEvent({ tick, kind: 'io-in', message: `IN 03h → ${hex(v, 2)}  (line ${trace.line})` });
        this.lastSensorRead = v;
      }
    }
    for (const b of this.pendingBus) this.pushEvent({ tick, kind: 'bus', message: b.message });
    this.pendingBus = [];

    const events = stepWorld(this.world, this.scenario, this.control, MS_PER_TICK);
    for (const e of events) this.pushEvent({ tick, kind: e.kind, message: e.message });
  }

  protected saveDevice(): RailDevice {
    return { world: structuredClone(this.world), control: this.control, lastSensorRead: this.lastSensorRead };
  }

  protected restoreDevice(d: RailDevice): void {
    this.world = structuredClone(d.world);
    this.control = d.control;
    this.lastSensorRead = d.lastSensorRead;
  }
}
