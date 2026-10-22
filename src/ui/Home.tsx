import { Icon } from './Icon';
import { Logo } from './Workbench';

/** Decorative crossing illustration for the home page (CSS-animated, not the simulator). */
function HeroCrossing() {
  return (
    <svg className="hero-art" viewBox="0 0 520 300" role="img" aria-label="Illustration of a railway level crossing">
      <defs>
        <pattern id="h-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="#222a30" />
        </pattern>
        <pattern id="h-sleepers" width="10" height="22" patternUnits="userSpaceOnUse">
          <rect x="1" width="5" height="22" fill="#2b3237" />
        </pattern>
        <pattern id="h-stripes" width="16" height="8" patternUnits="userSpaceOnUse">
          <rect x="8" width="8" height="8" fill="#d84a43" />
        </pattern>
        <radialGradient id="h-glow">
          <stop offset="0%" stopColor="#ff5a4f" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ff5a4f" stopOpacity="0" />
        </radialGradient>
        <clipPath id="h-clip">
          <rect width="520" height="300" rx="10" />
        </clipPath>
      </defs>
      <g clipPath="url(#h-clip)">
        <rect width="520" height="300" fill="#121619" />
        <rect width="520" height="300" fill="url(#h-grid)" />
        {/* road */}
        <rect x="226" y="0" width="68" height="300" fill="#22282c" />
        <line x1="260" x2="260" y1="0" y2="100" stroke="#6b5530" strokeWidth="1.5" strokeDasharray="9 8" />
        <line x1="260" x2="260" y1="200" y2="300" stroke="#6b5530" strokeWidth="1.5" strokeDasharray="9 8" />
        {/* track */}
        <rect x="0" y="128" width="520" height="44" fill="#171b1e" />
        <rect x="0" y="139" width="520" height="22" fill="url(#h-sleepers)" />
        <line x1="0" x2="520" y1="144" y2="144" stroke="#7d8790" strokeWidth="1.6" />
        <line x1="0" x2="520" y1="156" y2="156" stroke="#7d8790" strokeWidth="1.6" />
        {/* train */}
        <g className="hero-train">
          <rect x="0" y="139" width="70" height="22" rx="6" fill="#2c3a45" stroke="#0b0d0f" />
          <rect x="6" y="147.5" width="58" height="5" rx="1" fill="#e8b45c" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={-88 - i * 88} y="139" width="84" height="22" rx="3" fill="#46586a" stroke="#0b0d0f" />
          ))}
          <path d="M70 146 L130 132 L130 168 L70 154 Z" fill="#fff2c4" opacity="0.25" />
        </g>
        {/* barriers */}
        <g transform="translate(212 104)">
          <g className="hero-boom">
            <rect x="0" y="-3.5" width="96" height="7" rx="2.5" fill="#e9e4da" />
            <rect x="0" y="-3.5" width="96" height="7" rx="2.5" fill="url(#h-stripes)" />
          </g>
          <rect x="-8" y="-8" width="16" height="16" rx="3" fill="#2a3238" stroke="#4a555e" />
        </g>
        <g transform="translate(308 196) rotate(180)">
          <g className="hero-boom">
            <rect x="0" y="-3.5" width="96" height="7" rx="2.5" fill="#e9e4da" />
            <rect x="0" y="-3.5" width="96" height="7" rx="2.5" fill="url(#h-stripes)" />
          </g>
          <rect x="-8" y="-8" width="16" height="16" rx="3" fill="#2a3238" stroke="#4a555e" />
        </g>
        {/* lamps */}
        {[
          [170, 104],
          [350, 196],
        ].map(([x, y]) => (
          <g key={x} className="hero-lamps">
            <rect x={x - 19} y={y - 8} width="38" height="16" rx="8" fill="#15191c" stroke="#3a444c" />
            <circle className="hero-lamp hero-lamp--a" cx={x - 9} cy={y} r="5.5" />
            <circle className="hero-lamp hero-lamp--b" cx={x + 9} cy={y} r="5.5" />
          </g>
        ))}
        {/* waiting cars */}
        <rect x="232" y="30" width="20" height="34" rx="4" fill="#7a8fa6" stroke="#0b0d0f" />
        <rect x="268" y="236" width="20" height="34" rx="4" fill="#c4a46b" stroke="#0b0d0f" />
      </g>
    </svg>
  );
}

const CODE: [string, string][] = [
  ['IDLE:', '  IN   AL, 03h      ; read train sensors'],
  ['', '  TEST AL, 03h      ; train approaching?'],
  ['', '  JZ   IDLE'],
  ['', '  MOV  AL, 07h      ; lamps + buzzer + gate'],
  ['', '  OUT  02h, AL      ; lower the barriers'],
];

function CodeCard() {
  return (
    <div className="hero-code" aria-hidden="true">
      <div className="hero-code__bar">
        <span />
        <span />
        <span />
        <em>controller.asm</em>
      </div>
      <pre>
        {CODE.map(([label, rest], i) => {
          const [instr, comment] = rest.split(';');
          const m = /^(\s*)(\S+)(\s*)(.*)$/.exec(instr)!;
          return (
            <div key={i}>
              <span className="c-label">{label.padEnd(5)}</span>
              {m[1]}
              <span className="c-op">{m[2]}</span>
              {m[3]}
              <span className="c-args">{m[4]}</span>
              {comment && <span className="c-cmt">;{comment}</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

export function Home() {
  return (
    <div className="home">
      <header className="home__nav">
        <span className="brand">
          <Logo />
          <span className="brand__name">RailLogic</span>
        </span>
        <a className="home__navlink" href="#/railway">
          Open Railway Lab <Icon name="arrow" size={13} />
        </a>
      </header>

      <main className="home__hero">
        <section className="home__copy">
          <p className="home__eyebrow">Custom 8086 execution engine</p>
          <h1>
            Railway gate control,
            <br />
            written in <span>real 8086 assembly</span>.
          </h1>
          <p className="home__lead">
            I built my own 8086 engine specifically for railway level-crossing simulation. Your assembly program is assembled and executed instruction by
            instruction: it reads live train sensors through <code>IN</code> and drives the warning lamps, buzzer and boom barriers through <code>OUT</code>.
          </p>
          <div className="home__actions">
            <a className="btn btn--primary home__cta" href="#/railway">
              Open Railway Lab <Icon name="arrow" />
            </a>
            <span className="home__hint">
              Then press <kbd>F5</kbd> to run the example controller
            </span>
          </div>

          <ul className="home__facts">
            <li>
              <b>Own engine</b>
              <span>Assembler, CPU, flags and I/O bus written from scratch</span>
            </li>
            <li>
              <b>Real hardware I/O</b>
              <span>Sensors on port 03h, gate control on port 02h</span>
            </li>
            <li>
              <b>Deterministic</b>
              <span>Step, rewind and replay any moment exactly</span>
            </li>
          </ul>
        </section>

        <section className="home__visual">
          <HeroCrossing />
          <CodeCard />
        </section>
      </main>

      <footer className="home__foot">RailLogic · 8086 assembly · railway level-crossing simulation</footer>
    </div>
  );
}
