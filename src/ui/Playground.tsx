import { useRef, useState } from 'react';
import { DEFAULT_PLAYGROUND_SAMPLE, PLAYGROUND_SAMPLES } from '../programs/playgroundSamples';
import { CpuPanel } from './panels/CpuPanel';
import { LogPanel } from './panels/LogPanel';
import { DevicesPanel, MemoryPanel, OutputPanel, PlaygroundIoMap } from './panels/PlaygroundPanels';
import { Splitter, useSplit } from './Splitter';
import { useSimController } from './useSimController';
import { EditorPane, ExecControls, getDraft, RunPill, SampleSelect, SpeedSelect, StatusBar, TopBar, useJump, useWorkbench } from './Workbench';

/** 8086 Playground: general-purpose assembly with the same engine and debugger, no railway world. */
export function Playground() {
  const draft = getDraft('playground', DEFAULT_PLAYGROUND_SAMPLE);
  const c = useSimController(draft.source, '', 'playground', '100hz');
  const [sampleId, setSampleId] = useState(draft.sampleId);
  const { jumpTo, jump } = useJump();
  const workspaceRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const cols = useSplit('pg-cols', 0.42, 0.22, 0.7);
  const rows = useSplit('pg-rows', 0.42, 0.25, 0.75);
  useWorkbench(c, 'playground', sampleId);

  const m = c.playSim;
  const version = m ? m.tick : -1;

  return (
    <div className="app">
      <TopBar mode="playground" right={<RunPill state={c.runState} />}>
        <SampleSelect c={c} samples={PLAYGROUND_SAMPLES} sampleId={sampleId} onSampleId={setSampleId} />
        <ExecControls c={c} />
        <div className="tb-group">
          <SpeedSelect c={c} title="Instructions executed per real second" />
        </div>
      </TopBar>

      <main className="workspace" ref={workspaceRef} style={{ ['--cols' as string]: `${cols.fraction * 100}%` }}>
        <EditorPane c={c} jumpTo={jumpTo} onJump={jump} fileName="program.asm" />

        <Splitter direction="vertical" containerRef={workspaceRef} onChange={cols.setFraction} label="Resize editor and output" />

        <div className="pane pane--right" ref={rightRef} style={{ ['--rows' as string]: `${rows.fraction * 100}%` }}>
          <div className="pg-top">
            <OutputPanel m={m} version={version} />
            <DevicesPanel
              m={m}
              onToggleSwitch={(bit) => {
                if (!m) return;
                m.setSwitches(m.switches ^ (1 << bit)); // read the live value so rapid clicks are not lost
                c.bump();
              }}
            />
          </div>
          <Splitter direction="horizontal" containerRef={rightRef} onChange={rows.setFraction} label="Resize output and debugger" />
          <div className="debug">
            <div className="debug-col">
              <CpuPanel cpu={m?.cpu ?? null} program={c.program} tick={m?.tick ?? -1} />
              <MemoryPanel cpu={m?.cpu ?? null} program={c.program} />
            </div>
            <LogPanel events={m?.eventLog ?? []} trace={m?.execLog ?? []} version={version} onJumpToLine={jump} ioMap={<PlaygroundIoMap />} />
          </div>
        </div>
      </main>

      <StatusBar c={c} />
    </div>
  );
}
