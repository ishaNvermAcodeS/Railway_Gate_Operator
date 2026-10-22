/**
 * Pure SVG renderer for the level crossing.
 *
 * Everything drawn here is a function of (world state, control latch, sensor
 * byte). There is no animation timeline: motion comes from the simulation
 * advancing, and the lamp flasher phase comes from simulated time.
 */
import { decodeControl, SENSE } from '../hardware/ports';
import type { Scenario } from '../sim/scenarios';
import { GEOMETRY, lampPhase, trainTail, VEHICLE_DIMENSIONS, type Train, type Vehicle, type WorldState } from '../sim/world';

const W = 1200;
const H = 560;
const CX = W / 2;
const CY = 280;
const SX = 0.5; // px per world unit along the track
const SY = 1.1; // px per world unit along the road
const ROAD_HALF = 34;

const px = (x: number) => CX + x * SX;
const py = (y: number) => CY + y * SY;

const TRACK_N = py(GEOMETRY.trackY.westbound);
const TRACK_S = py(GEOMETRY.trackY.eastbound);

interface Props {
  world: WorldState;
  control: number;
  sensors: number;
  scenario: Scenario;
}

function Rails({ y }: { y: number }) {
  return (
    <g>
      <rect x={0} y={y - 12} width={W} height={24} fill="url(#sleepers)" />
      <line x1={0} x2={W} y1={y - 6} y2={y - 6} className="rail" />
      <line x1={0} x2={W} y1={y + 6} y2={y + 6} className="rail" />
    </g>
  );
}

function Section({ x1, x2, y, active, label, labelBelow }: { x1: number; x2: number; y: number; active: boolean; label: string; labelBelow?: boolean }) {
  const a = px(Math.min(x1, x2));
  const b = px(Math.max(x1, x2));
  return (
    <g className={`section ${active ? 'section--on' : ''}`}>
      <line x1={a} x2={b} y1={y} y2={y} />
      <line x1={a} x2={a} y1={y - 4} y2={y + 4} />
      <line x1={b} x2={b} y1={y - 4} y2={y + 4} />
      <text x={(a + b) / 2} y={labelBelow ? y + 13 : y - 7} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

const TRAIN_STYLE: Record<string, { body: string; stripe: string }> = {
  IC: { body: '#46586a', stripe: '#e8b45c' },
  RE: { body: '#5b4a62', stripe: '#c8d1d9' },
  FR: { body: '#6b4a37', stripe: '#9a7b5a' },
};

function TrainShape({ t }: { t: Train }) {
  const style = TRAIN_STYLE[t.name.slice(0, 2)] ?? TRAIN_STYLE.IC;
  const y = t.dir === 1 ? TRACK_S : TRACK_N;
  const tail = trainTail(t);
  const carLen = t.name.startsWith('FR') ? 70 : 80;
  const locoLen = 64;
  const gap = 5;
  const parts: { from: number; to: number; loco: boolean }[] = [];
  // Build from the head backwards (distances measured along the direction of travel).
  let d = 0;
  parts.push({ from: 0, to: locoLen, loco: true });
  d = locoLen + gap;
  while (d < t.length - 10) {
    const end = Math.min(t.length, d + carLen);
    parts.push({ from: d, to: end, loco: false });
    d = end + gap;
  }
  const at = (dist: number) => t.head - t.dir * dist;
  const headX = px(t.head);
  return (
    <g className="train">
      {/* headlight beam */}
      <path
        d={`M ${headX} ${y - 4} L ${headX + t.dir * 60} ${y - 17} L ${headX + t.dir * 60} ${y + 17} L ${headX} ${y + 4} Z`}
        fill={t.dir === 1 ? 'url(#beam)' : 'url(#beamRev)'}
        opacity={0.55}
      />
      {parts.map((p, i) => {
        const x1 = px(Math.min(at(p.from), at(p.to)));
        const x2 = px(Math.max(at(p.from), at(p.to)));
        return (
          <g key={i}>
            <rect x={x1} y={y - 11} width={x2 - x1} height={22} rx={p.loco ? 6 : 3} fill={p.loco ? '#2c3a45' : style.body} stroke="#0b0d0f" strokeWidth={1} />
            {p.loco ? (
              <rect x={x1 + 5} y={y - 2.5} width={x2 - x1 - 10} height={5} rx={1} fill={style.stripe} opacity={0.9} />
            ) : (
              <line x1={x1 + 3} x2={x2 - 3} y1={y} y2={y} stroke={style.stripe} strokeWidth={1} opacity={0.5} />
            )}
          </g>
        );
      })}
      <circle cx={headX - t.dir * 2.5} cy={y - 7} r={2} fill="#fff6d8" />
      <circle cx={headX - t.dir * 2.5} cy={y + 7} r={2} fill="#fff6d8" />
      <text x={px((t.head + tail) / 2)} y={y + 4} textAnchor="middle" className="train-label">
        {t.name} {t.dir === 1 ? '→' : '←'}
      </text>
    </g>
  );
}

function VehicleShape({ v }: { v: Vehicle }) {
  const { length, width } = VEHICLE_DIMENSIONS;
  const laneX = v.lane === 'S' ? CX - ROAD_HALF / 2 : CX + ROAD_HALF / 2;
  const front = py(v.front);
  const len = length * SY;
  const y = v.lane === 'S' ? front - len : front;
  const windshield = v.lane === 'S' ? front - 11 : front + 5;
  const w = width * 1.15;
  return (
    <g className={v.flagged ? 'vehicle vehicle--hit' : 'vehicle'}>
      <rect x={laneX - w / 2} y={y} width={w} height={len} rx={3.5} fill={v.color} stroke="#0b0d0f" />
      <rect x={laneX - w / 2 + 2.5} y={windshield} width={w - 5} height={6} rx={1.5} fill="#1b2126" opacity={0.85} />
    </g>
  );
}

/** Plan-view boom barrier: rotates from across the road (down) to along the road (up). */
function Barrier({ side, pos }: { side: 'N' | 'S'; pos: number }) {
  const pivotX = side === 'N' ? CX - ROAD_HALF - 8 : CX + ROAD_HALF + 8;
  const pivotY = side === 'N' ? py(-GEOMETRY.stopLine + 12) : py(GEOMETRY.stopLine - 12);
  const length = ROAD_HALF * 2 + 14;
  const baseAngle = side === 'N' ? 0 : 180;
  const angle = baseAngle - 90 * (1 - pos);
  return (
    <g>
      <g transform={`translate(${pivotX} ${pivotY}) rotate(${angle})`}>
        <rect x={0} y={-3.5} width={length} height={7} rx={2.5} fill="#e9e4da" />
        <rect x={0} y={-3.5} width={length} height={7} rx={2.5} fill="url(#boomStripes)" />
      </g>
      <rect x={pivotX - 8} y={pivotY - 8} width={16} height={16} rx={3} fill="var(--sc-housing)" stroke="var(--sc-housing-line)" />
    </g>
  );
}

function LampMast({ x, y, lit, phase }: { x: number; y: number; lit: boolean; phase: 0 | 1 }) {
  const on = (i: 0 | 1) => lit && phase === i;
  return (
    <g>
      <rect x={x - 19} y={y - 8} width={38} height={16} rx={8} fill="var(--sc-mast)" stroke="var(--sc-mast-line)" />
      {[0, 1].map((i) => (
        <g key={i}>
          {on(i as 0 | 1) && <circle cx={x - 9 + i * 18} cy={y} r={16} fill="url(#lampGlow)" />}
          <circle cx={x - 9 + i * 18} cy={y} r={5.5} className={on(i as 0 | 1) ? 'lamp lamp--on' : 'lamp'} />
        </g>
      ))}
    </g>
  );
}

function Buzzer({ x, y, on, t }: { x: number; y: number; on: boolean; t: number }) {
  const phase = (t % 600) / 600;
  return (
    <g className={on ? 'buzzer buzzer--on' : 'buzzer'}>
      <rect x={x - 7} y={y - 7} width={14} height={14} rx={2} />
      {on &&
        [0, 1, 2].map((i) => {
          const r = 8 + ((phase + i / 3) % 1) * 14;
          return <circle key={i} cx={x} cy={y} r={r} fill="none" stroke="#e8b45c" strokeOpacity={1 - ((phase + i / 3) % 1)} strokeWidth={1} />;
        })}
    </g>
  );
}

/** Side elevation of the boom showing its true angle. */
function ElevationInset({ pos, x, y }: { pos: number; x: number; y: number }) {
  const angle = -85 * (1 - pos);
  return (
    <g transform={`translate(${x} ${y})`} className="inset">
      <rect x={0} y={0} width={150} height={92} rx={4} />
      <text x={8} y={14}>BOOM ELEVATION</text>
      <text x={142} y={14} textAnchor="end" className="inset-value">
        {Math.round(85 * (1 - pos))}°
      </text>
      <line x1={10} x2={140} y1={78} y2={78} stroke="var(--sc-mast-line)" />
      <rect x={24} y={52} width={10} height={26} fill="var(--sc-housing)" stroke="var(--sc-housing-line)" />
      <g transform={`translate(29 56) rotate(${angle})`}>
        <rect x={0} y={-2} width={100} height={4} rx={1.5} fill="#e9e4da" />
        <rect x={0} y={-2} width={100} height={4} rx={1.5} fill="url(#boomStripes)" />
      </g>
      <circle cx={29} cy={56} r={2.5} fill="#8b98a3" />
    </g>
  );
}

export function CrossingView({ world, control, sensors, scenario }: Props) {
  const out = decodeControl(control);
  const phase = lampPhase(world);
  const s = (m: number) => (sensors & m) !== 0;
  const { strike, island, clearOut } = GEOMETRY;
  const stuckBits = new Set(scenario.faults.filter((f) => f.kind === 'sensor-stuck' && world.timeMs >= f.fromMs).map((f) => (f.kind === 'sensor-stuck' ? f.bit : -1)));
  const jam = scenario.faults.some((f) => f.kind === 'gate-jam' && world.timeMs >= f.fromMs);
  const roadTop = py(-GEOMETRY.roadEnd - 40);
  const roadBottom = py(GEOMETRY.roadEnd + 40);
  const trainOnIsland = s(SENSE.OCCUPIED);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="crossing-svg" role="img" aria-label="Railway level crossing simulation">
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="var(--sc-grid)" />
        </pattern>
        <pattern id="sleepers" width="10" height="24" patternUnits="userSpaceOnUse">
          <rect x="1" y="0" width="5" height="24" fill="var(--sc-sleeper)" />
        </pattern>
        <pattern id="boomStripes" width="18" height="8" patternUnits="userSpaceOnUse">
          <rect x="9" y="0" width="9" height="8" fill="#d84a43" />
        </pattern>
        <radialGradient id="lampGlow">
          <stop offset="0%" stopColor="#ff5a4f" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ff5a4f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="beam" x1="0" x2="1">
          <stop offset="0%" stopColor="#fff2c4" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fff2c4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="beamRev" x1="1" x2="0">
          <stop offset="0%" stopColor="#fff2c4" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fff2c4" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width={W} height={H} fill="var(--sc-bg)" />
      <rect width={W} height={H} fill="url(#grid)" />

      {/* road */}
      <rect x={CX - ROAD_HALF - 6} y={roadTop} width={(ROAD_HALF + 6) * 2} height={roadBottom - roadTop} fill="var(--sc-shoulder)" />
      <rect x={CX - ROAD_HALF} y={roadTop} width={ROAD_HALF * 2} height={roadBottom - roadTop} fill="var(--sc-road)" />
      <line x1={CX - ROAD_HALF} x2={CX - ROAD_HALF} y1={roadTop} y2={roadBottom} stroke="var(--sc-road-edge)" />
      <line x1={CX + ROAD_HALF} x2={CX + ROAD_HALF} y1={roadTop} y2={roadBottom} stroke="var(--sc-road-edge)" />
      <line x1={CX} x2={CX} y1={roadTop} y2={py(-GEOMETRY.stopLine)} className="road-center" />
      <line x1={CX} x2={CX} y1={py(GEOMETRY.stopLine)} y2={roadBottom} className="road-center" />
      <line x1={CX - ROAD_HALF} x2={CX} y1={py(-GEOMETRY.stopLine)} y2={py(-GEOMETRY.stopLine)} className="stop-line" />
      <line x1={CX} x2={CX + ROAD_HALF} y1={py(GEOMETRY.stopLine)} y2={py(GEOMETRY.stopLine)} className="stop-line" />

      {/* tracks */}
      <rect x={0} y={TRACK_N - 20} width={W} height={TRACK_S - TRACK_N + 40} fill="var(--sc-track)" />
      <Rails y={TRACK_N} />
      <Rails y={TRACK_S} />
      <text x={14} y={TRACK_N - 26} className="track-label">TRACK 1 · WESTBOUND ←</text>
      <text x={14} y={TRACK_S + 35} className="track-label">TRACK 2 · EASTBOUND →</text>

      {/* crossing island */}
      <rect
        x={px(-island)}
        y={TRACK_N - 24}
        width={px(island) - px(-island)}
        height={TRACK_S - TRACK_N + 48}
        className={`island ${trainOnIsland ? 'island--on' : ''}`}
      />
      <text x={px(island) + 40} y={TRACK_N - 30} className={`section-tag ${trainOnIsland ? 'section-tag--on' : ''}`}>
        ISLAND · b2
      </text>

      {/* detection sections */}
      <Section x1={-strike} x2={-island} y={TRACK_S + 32} active={s(SENSE.APPR_W)} label={`APPR W · b0${stuckBits.has(0) ? ' (STUCK)' : ''}`} labelBelow />
      <Section x1={island} x2={clearOut} y={TRACK_S + 32} active={s(SENSE.CLEAR_E)} label="CLR E · b4" labelBelow />
      <Section x1={island} x2={strike} y={TRACK_N - 32} active={s(SENSE.APPR_E)} label={`APPR E · b1${stuckBits.has(1) ? ' (STUCK)' : ''}`} />
      <Section x1={-clearOut} x2={-island} y={TRACK_N - 32} active={s(SENSE.CLEAR_W)} label="CLR W · b3" />
      {[-strike, strike].map((x) => (
        <g key={x} className="strike">
          <line x1={px(x)} x2={px(x)} y1={TRACK_N - 18} y2={TRACK_S + 18} />
          <text x={px(x)} y={TRACK_S + 64} textAnchor="middle">
            STRIKE-IN {x < 0 ? 'W' : 'E'}
          </text>
        </g>
      ))}

      {/* trains & vehicles */}
      {world.vehicles.map((v) => (
        <VehicleShape key={v.id} v={v} />
      ))}
      {world.trains.map((t) => (
        <TrainShape key={t.id} t={t} />
      ))}

      {/* barriers, lamps, buzzer */}
      <Barrier side="N" pos={world.gatePos} />
      <Barrier side="S" pos={world.gatePos} />
      <LampMast x={CX - ROAD_HALF - 40} y={py(-GEOMETRY.stopLine + 12)} lit={out.lights} phase={phase} />
      <LampMast x={CX + ROAD_HALF + 40} y={py(GEOMETRY.stopLine - 12)} lit={out.lights} phase={phase} />
      <Buzzer x={CX - ROAD_HALF - 40} y={py(-GEOMETRY.stopLine + 12) - 28} on={out.buzzer} t={world.timeMs} />
      {jam && (
        <text x={CX + ROAD_HALF + 14} y={py(-GEOMETRY.stopLine + 12) + 4} className="jam-tag">
          MOTOR JAMMED
        </text>
      )}

      {/* road labels */}
      <text x={CX + ROAD_HALF + 10} y={roadTop + 16} className="road-label">
        ROAD · NORTH
      </text>
      <text x={CX + ROAD_HALF + 10} y={roadBottom - 8} className="road-label">
        ROAD · SOUTH
      </text>

      <ElevationInset pos={world.gatePos} x={W - 166} y={H - 104} />
    </svg>
  );
}
