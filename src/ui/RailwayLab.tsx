import { useRef, useState } from 'react';
import { DEFAULT_SAMPLE, SAMPLES } from '../programs/samples';
import { SCENARIOS } from '../sim/scenarios';
import { CpuPanel } from './panels/CpuPanel';
import { LogPanel } from './panels/LogPanel';
import { PortsPanel } from './panels/PortsPanel';
import { SimulatorPane } from './SimulatorPane';
import { Splitter, useSplit } from './Splitter';
import { useSimController } from './useSimController';
import { EditorPane, ExecControls, getDraft, RunPill, SampleSelect, SpeedSelect, StatusBar, TopBar, useJump, useWorkbench } from './Workbench';

/** Railway Lab: the level-crossing simulator, unchanged in layout and behaviour. */
export function RailwayLab() {
  const draft = getDraft(DEFAULT_SAMPLE);
  const c = useSimController(draft.source, SCENARIOS[0].id);
  const [sampleId, setSampleId] = useState(draft.sampleId);
  const { jumpTo, jump } = useJump();
  const workspaceRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const cols = useSplit('cols', 0.4, 0.22, 0.7);
  const rows = useSplit('rows', 0.58, 0.3, 0.8);
  useWorkbench(c, sampleId);

  const sim = c.sim;

  return (
    <div className="app">
      <TopBar right={<RunPill state={c.runState} />}>
        <SampleSelect c={c} samples={SAMPLES} sampleId={sampleId} onSampleId={setSampleId} />
        <ExecControls c={c} />
        <div className="tb-group">
          <SpeedSelect c={c} title="Instructions per real second. 1 instruction = 1 ms of simulated time." />
          <label className="tb-field">
            <span>Scenario</span>
            <select value={c.scenarioId} onChange={(e) => c.selectScenario(e.target.value)} title={c.scenario.summary}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </TopBar>

      <main className="workspace" ref={workspaceRef} style={{ ['--cols' as string]: `${cols.fraction * 100}%` }}>
        <EditorPane c={c} jumpTo={jumpTo} onJump={jump} fileName="controller.asm" />

        <Splitter direction="vertical" containerRef={workspaceRef} onChange={cols.setFraction} label="Resize editor and simulator" />

        <div className="pane pane--right" ref={rightRef} style={{ ['--rows' as string]: `${rows.fraction * 100}%` }}>
          <SimulatorPane sim={sim} world={c.world} scenario={c.scenario} runState={c.runState} onSeek={c.actions.seek} />
          <Splitter direction="horizontal" containerRef={rightRef} onChange={rows.setFraction} label="Resize simulator and debugger" />
          <div className="debug">
            <div className="debug-col">
              <CpuPanel cpu={sim?.cpu ?? null} program={c.program} tick={sim?.tick ?? -1} />
              <PortsPanel control={sim?.control ?? 0} sensors={sim ? sim.sensors : 0x40} scenario={c.scenario} timeMs={c.world.timeMs} />
            </div>
            <LogPanel events={sim?.eventLog ?? []} trace={sim?.execLog ?? []} version={sim ? sim.tick : -1} onJumpToLine={jump} />
          </div>
        </div>
      </main>

      <StatusBar c={c} />
    </div>
  );
}
