/**
 * Deterministic railway scenarios. A scenario is pure data: when trains
 * appear, how road traffic is generated and which faults are injected.
 * Nothing here is random, so a program + scenario pair always produces the
 * same simulation.
 */

export interface TrainSpec {
  /** +1 = eastbound (enters from the west), −1 = westbound (enters from the east). */
  dir: 1 | -1;
  spawnMs: number;
  /** World units per millisecond. */
  speed: number;
  length: number;
  name: string;
}

export type Fault =
  | { kind: 'gate-jam'; fromMs: number; description: string }
  | { kind: 'sensor-stuck'; bit: number; value: 0 | 1; fromMs: number; description: string };

export interface Scenario {
  id: string;
  name: string;
  summary: string;
  durationMs: number;
  trains: TrainSpec[];
  traffic: { southEveryMs: number; southOffsetMs: number; northEveryMs: number; northOffsetMs: number };
  faults: Fault[];
}

const TRAFFIC = { southEveryMs: 3600, southOffsetMs: 400, northEveryMs: 4300, northOffsetMs: 1700 };
const EXPRESS = { speed: 0.09, length: 300 };

export const SCENARIOS: Scenario[] = [
  {
    id: 'eastbound',
    name: 'Normal · eastbound train',
    summary: 'A single passenger train approaches from the west on the southern track.',
    durationMs: 32000,
    trains: [{ dir: 1, spawnMs: 1500, ...EXPRESS, name: 'IC 2041' }],
    traffic: TRAFFIC,
    faults: [],
  },
  {
    id: 'westbound',
    name: 'Normal · westbound train',
    summary: 'A single train approaches from the east on the northern track.',
    durationMs: 32000,
    trains: [{ dir: -1, spawnMs: 1500, ...EXPRESS, name: 'IC 2046' }],
    traffic: TRAFFIC,
    faults: [],
  },
  {
    id: 'following',
    name: 'Second train following',
    summary: 'A freight train follows the first train closely. The gate must stay down until both have cleared.',
    durationMs: 46000,
    trains: [
      { dir: 1, spawnMs: 1500, ...EXPRESS, name: 'IC 2041' },
      { dir: 1, spawnMs: 12500, speed: 0.07, length: 420, name: 'FR 7720' },
    ],
    traffic: TRAFFIC,
    faults: [],
  },
  {
    id: 'opposing',
    name: 'Trains from both directions',
    summary: 'Trains approach from both sides on separate tracks, overlapping at the crossing.',
    durationMs: 40000,
    trains: [
      { dir: 1, spawnMs: 1500, ...EXPRESS, name: 'IC 2041' },
      { dir: -1, spawnMs: 7000, speed: 0.08, length: 260, name: 'RE 318' },
    ],
    traffic: TRAFFIC,
    faults: [],
  },
  {
    id: 'fault-gate-jam',
    name: 'Fault · gate motor jammed',
    summary: 'The barrier motor fails and the booms never leave the raised position. The GATE DN limit switch never closes.',
    durationMs: 32000,
    trains: [{ dir: 1, spawnMs: 1500, ...EXPRESS, name: 'IC 2041' }],
    traffic: TRAFFIC,
    faults: [{ kind: 'gate-jam', fromMs: 0, description: 'Barrier motor jammed in the raised position' }],
  },
  {
    id: 'fault-dead-approach',
    name: 'Fault · east approach detector dead',
    summary: 'The east approach detector (bit 1) is stuck at 0. A westbound train is only detected when it reaches the island.',
    durationMs: 32000,
    trains: [{ dir: -1, spawnMs: 1500, ...EXPRESS, name: 'IC 2046' }],
    traffic: TRAFFIC,
    faults: [{ kind: 'sensor-stuck', bit: 1, value: 0, fromMs: 0, description: 'APPR E detector stuck at 0' }],
  },
  {
    id: 'fault-stuck-approach',
    name: 'Fault · west approach stuck ON',
    summary: 'The west approach detector (bit 0) sticks at 1 from t = 3 s although no train is coming. A real train follows later.',
    durationMs: 56000,
    trains: [{ dir: -1, spawnMs: 30000, ...EXPRESS, name: 'IC 2046' }],
    traffic: TRAFFIC,
    faults: [{ kind: 'sensor-stuck', bit: 0, value: 1, fromMs: 3000, description: 'APPR W detector stuck at 1' }],
  },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
