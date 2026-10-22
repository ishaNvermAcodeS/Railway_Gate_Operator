import { useState } from 'react';
import type { Diagnostic } from '../../engine/types';
import { Icon } from '../Icon';

interface Props {
  diagnostics: Diagnostic[];
  onJump(line: number, column: number): void;
}

export function ProblemsPanel({ diagnostics, onJump }: Props) {
  const [open, setOpen] = useState(true);
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  return (
    <section className={`problems ${open ? 'problems--open' : ''}`} aria-label="Problems">
      <button className="problems__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="problems__chev">{open ? '▾' : '▸'}</span>
        <span>Problems</span>
        <span className={`count ${errors ? 'count--err' : ''}`}>
          <Icon name="error" size={12} /> {errors}
        </span>
        <span className={`count ${warnings ? 'count--warn' : ''}`}>
          <Icon name="warn" size={12} /> {warnings}
        </span>
      </button>
      {open && (
        <div className="problems__list">
          {diagnostics.length === 0 && (
            <div className="problems__ok">
              <Icon name="check" size={12} /> No problems — the program assembles cleanly.
            </div>
          )}
          {diagnostics.map((d, i) => (
            <button key={i} className={`problem problem--${d.severity}`} onClick={() => onJump(d.line, d.startColumn)}>
              <Icon name={d.severity === 'error' ? 'error' : 'warn'} size={12} />
              <span className="problem__loc">
                {d.line}:{d.startColumn}
              </span>
              <span className="problem__msg">{d.message}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
