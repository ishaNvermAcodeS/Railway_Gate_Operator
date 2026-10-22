import { useEffect, useState } from 'react';
import { ArchDiagram } from './ArchDiagram';
import { Icon } from './Icon';
import { Logo, ThemeToggle } from './Workbench';

const WIDE = '(min-width: 1100px)';

function useWide() {
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** A mode card styled as a DIP chip: pins on both edges, an index and a label. */
function ModeCard({ href, index, title, body, tags }: { href: string; index: string; title: string; body: string; tags: string[] }) {
  return (
    <a className="chip-card" href={href}>
      <span className="chip-card__notch" aria-hidden="true" />
      <span className="chip-card__index">{index}</span>
      <span className="chip-card__body">
        <span className="chip-card__title">{title}</span>
        <span className="chip-card__text">{body}</span>
        <span className="chip-card__tags">
          {tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </span>
      </span>
      <span className="chip-card__go" aria-hidden="true">
        <Icon name="arrow" size={16} />
      </span>
    </a>
  );
}

export function Home() {
  const wide = useWide();
  return (
    <div className={`home ${wide ? 'home--wide' : ''}`}>
      <div className="home__bg">
        <ArchDiagram fit={wide ? 'meet' : 'slice'} />
      </div>
      <div className="home__veil" />

      <header className="home__nav">
        <span className="brand">
          <Logo />
          <span className="brand__name">Hex86</span>
        </span>
        <ThemeToggle />
      </header>

      <main className="home__main">
        <p className="home__status">
          <span className="home__status-dot" />
          8086 core running live in the background
        </p>
        <h1>
          Hex<span>86</span>
        </h1>
        <p className="home__subtitle">8086 Assembly &amp; Hardware Simulation Platform</p>
        <p className="home__lead">
          I built my own 8086 execution engine from scratch: assembler, CPU, flags, memory and I/O bus. It was made to simulate a railway level crossing driven
          by real 8086 assembly, and runs programs instruction by instruction with a full debugger.
        </p>

        <nav className="chip-cards" aria-label="Choose a mode">
          <ModeCard
            href="#/playground"
            index="01"
            title="8086 Playground"
            body="General-purpose programs: arithmetic, loops, arrays and subroutines."
            tags={['console output', 'registers', 'memory view']}
          />
          <ModeCard
            href="#/railway"
            index="02"
            title="Railway Lab"
            body="Your program reads train sensors and drives the lamps and barriers."
            tags={['IN 03h sensors', 'OUT 02h gate', 'fault scenarios']}
          />
        </nav>
      </main>
    </div>
  );
}
