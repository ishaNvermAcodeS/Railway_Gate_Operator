import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor/editor/editor.api.js';
import { memo, useEffect, useRef } from 'react';
import type { Diagnostic } from '../../engine/types';
import { useTheme } from '../theme';
import { LANGUAGE_ID, THEME_ID, THEME_LIGHT_ID } from './asmLanguage';
import './monacoSetup';

export type LineState = 'paused' | 'running' | 'fault';

interface Props {
  value: string;
  onChange(value: string): void;
  diagnostics: Diagnostic[];
  currentLine: number | null;
  lineState: LineState;
  breakpoints: ReadonlySet<number>;
  onToggleBreakpoint(line: number): void;
  /** Breakpoint decorations follow their lines when code is edited; this reports the new lines. */
  onBreakpointsMoved(lines: number[]): void;
  /** Bumped by the parent to request revealing the current line. */
  revealToken: number;
  /** Line to jump to (from the Problems panel). */
  jumpTo: { line: number; column: number; token: number } | null;
}

function AsmEditorImpl({ value, onChange, diagnostics, currentLine, lineState, breakpoints, onToggleBreakpoint, onBreakpointsMoved, revealToken, jumpTo }: Props) {
  const { theme } = useTheme();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const lineDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const bpDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const toggleRef = useRef(onToggleBreakpoint);
  toggleRef.current = onToggleBreakpoint;
  const movedRef = useRef(onBreakpointsMoved);
  movedRef.current = onBreakpointsMoved;
  const bpRef = useRef(breakpoints);
  bpRef.current = breakpoints;

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    lineDeco.current = editor.createDecorationsCollection();
    bpDeco.current = editor.createDecorationsCollection();
    editor.onMouseDown((e) => {
      const t = e.target.type;
      if (t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || t === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) {
        const line = e.target.position?.lineNumber;
        if (line) toggleRef.current(line);
      }
    });
    editor.onDidChangeModelContent(() => {
      // Nothing to track (also skips sample loads, which clear breakpoints first).
      if (bpRef.current.size === 0) return;
      const ranges = bpDeco.current?.getRanges() ?? [];
      const lines = [...new Set(ranges.map((r) => r.startLineNumber))].sort((a, b) => a - b);
      const current = [...bpRef.current].sort((a, b) => a - b);
      if (lines.join() !== current.join()) movedRef.current(lines);
    });
    editor.addAction({
      id: 'hex86.toggleBreakpoint',
      label: 'Toggle Breakpoint',
      keybindings: [monaco.KeyCode.F9],
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber;
        if (line) toggleRef.current(line);
      },
    });
    syncMarkers();
    syncBreakpoints();
    syncLine();
  };

  const syncMarkers = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      'hex86',
      diagnostics.map((d) => ({
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: d.message,
        startLineNumber: d.line,
        endLineNumber: d.line,
        startColumn: d.startColumn,
        endColumn: d.endColumn,
      })),
    );
  };

  const syncBreakpoints = () => {
    const monaco = monacoRef.current;
    if (!bpDeco.current || !monaco) return;
    bpDeco.current.set(
      [...breakpoints].map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { glyphMarginClassName: 'bp-glyph', glyphMarginHoverMessage: { value: 'Breakpoint (click or F9 to remove)' }, stickiness: 1 },
      })),
    );
  };

  const syncLine = () => {
    const monaco = monacoRef.current;
    if (!lineDeco.current || !monaco) return;
    if (currentLine === null) {
      lineDeco.current.clear();
      return;
    }
    lineDeco.current.set([
      {
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: {
          isWholeLine: true,
          className: `exec-line exec-line--${lineState}`,
          linesDecorationsClassName: `exec-arrow exec-arrow--${lineState}`,
        },
      },
    ]);
  };

  useEffect(syncMarkers, [diagnostics]);
  useEffect(syncBreakpoints, [breakpoints]);
  useEffect(syncLine, [currentLine, lineState]);

  useEffect(() => {
    if (currentLine !== null) editorRef.current?.revealLineInCenterIfOutsideViewport(currentLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealToken]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !jumpTo) return;
    editor.revealLineInCenter(jumpTo.line);
    editor.setPosition({ lineNumber: jumpTo.line, column: jumpTo.column });
    editor.focus();
  }, [jumpTo]);

  return (
    <Editor
      language={LANGUAGE_ID}
      theme={theme === 'light' ? THEME_LIGHT_ID : THEME_ID}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      loading={<div className="editor-loading">Loading editor…</div>}
      options={{
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
        fontSize: 13,
        lineHeight: 20,
        fontLigatures: false,
        minimap: { enabled: false },
        glyphMargin: true,
        lineDecorationsWidth: 14,
        lineNumbersMinChars: 3,
        renderLineHighlight: 'line',
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 8,
        insertSpaces: true,
        automaticLayout: true,
        padding: { top: 10, bottom: 10 },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        fixedOverflowWidgets: true,
        stickyScroll: { enabled: false },
        quickSuggestions: { other: true, comments: false, strings: false },
        wordBasedSuggestions: 'off',
      }}
    />
  );
}

export const AsmEditor = memo(AsmEditorImpl);
