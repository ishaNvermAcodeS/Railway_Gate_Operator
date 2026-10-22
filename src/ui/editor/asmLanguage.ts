import type * as Monaco from 'monaco-editor/editor/editor.api.js';
import { INSTRUCTIONS, KNOWN_UNSUPPORTED } from '../../engine/instructions';
import { REG16, REG8 } from '../../engine/registers';

export const LANGUAGE_ID = 'asm8086';
export const THEME_ID = 'hex86-dark';
export const THEME_LIGHT_ID = 'hex86-light';

let registered = false;

export function registerAsmLanguage(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.asm'], aliases: ['8086 Assembly'] });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: ';' },
    brackets: [['[', ']']],
    autoClosingPairs: [{ open: "'", close: "'" }],
  });

  const supported = [...INSTRUCTIONS.keys()].map((m) => m.toLowerCase());
  const unsupported = [...KNOWN_UNSUPPORTED].map((m) => m.toLowerCase());
  const registers = [...REG16, ...REG8].map((r) => r.toLowerCase());

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    ignoreCase: true,
    supported,
    unsupported,
    registers,
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/^\s*[A-Za-z_.@?][\w.@?$]*(?=\s*:)/, 'type.identifier'],
        [/[A-Za-z_.@?][\w.@?$]*(?=\s+equ\b)/, 'constant'],
        [/\bequ\b/, 'keyword.directive'],
        [/'.'/, 'string'],
        [/\b0x[0-9a-f]+\b/, 'number.hex'],
        [/\b[0-9][0-9a-f]*h\b/, 'number.hex'],
        [/\b0b[01]+\b|\b[01]+b\b/, 'number.binary'],
        [/\b[0-9]+d?\b/, 'number'],
        [
          /[A-Za-z_.@?][\w.@?$]*/,
          {
            cases: {
              '@supported': 'keyword',
              '@unsupported': 'invalid',
              '@registers': 'variable.predefined',
              '@default': 'identifier',
            },
          },
        ],
        [/[[\]]/, 'invalid'],
        [/[,:]/, 'delimiter'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);

  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const w = word.word.toUpperCase();
      const def = INSTRUCTIONS.get(w);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      if (def) {
        return {
          range,
          contents: [
            { value: `**${def.mnemonic}** — ${def.group}` },
            { value: def.summary },
            { value: '```asm8086\n' + def.syntax.join('\n') + '\n```' },
            { value: `Flags: ${def.flags}` },
          ],
        };
      }
      if (KNOWN_UNSUPPORTED.has(w)) {
        return { range, contents: [{ value: `**${w}** is an 8086 instruction that this simulator does not implement yet.` }] };
      }
      return null;
    },
  });

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const instr = [...INSTRUCTIONS.values()].map((d) => ({
        label: d.mnemonic,
        kind: monaco.languages.CompletionItemKind.Keyword,
        detail: d.syntax.join('  |  '),
        documentation: d.summary,
        insertText: d.mnemonic + ' ',
        range,
      }));
      const regs = [...REG16, ...REG8].map((r) => ({
        label: r,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: r,
        range,
      }));
      return { suggestions: [...instr, ...regs] };
    },
  });

  monaco.editor.defineTheme(THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5f6b73', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'e8b45c' },
      { token: 'keyword.directive', foreground: 'c792ea' },
      { token: 'invalid', foreground: 'f07178', fontStyle: 'underline' },
      { token: 'variable.predefined', foreground: '7fc8d8' },
      { token: 'type.identifier', foreground: 'c3e88d' },
      { token: 'constant', foreground: 'c792ea' },
      { token: 'identifier', foreground: 'c8d1d9' },
      { token: 'number', foreground: 'f78c6c' },
      { token: 'number.hex', foreground: 'f78c6c' },
      { token: 'number.binary', foreground: 'f78c6c' },
      { token: 'string', foreground: 'c3e88d' },
      { token: 'delimiter', foreground: '7d8790' },
    ],
    colors: {
      'editor.background': '#111417',
      'editor.foreground': '#c8d1d9',
      'editorLineNumber.foreground': '#3c464e',
      'editorLineNumber.activeForeground': '#8b98a3',
      'editor.lineHighlightBackground': '#171c20',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#2b3a47',
      'editorCursor.foreground': '#e8b45c',
      'editorIndentGuide.background1': '#1c2227',
      'editorGutter.background': '#111417',
      'editorWidget.background': '#171c20',
      'editorWidget.border': '#2a3238',
      'editorHoverWidget.background': '#171c20',
      'editorHoverWidget.border': '#2a3238',
      'scrollbarSlider.background': '#2a323880',
      'scrollbarSlider.hoverBackground': '#3a444c',
      'editorError.foreground': '#f07178',
      'editorWarning.foreground': '#e8b45c',
    },
  });

  monaco.editor.defineTheme(THEME_LIGHT_ID, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8a959e', fontStyle: 'italic' },
      { token: 'keyword', foreground: '9a6400' },
      { token: 'keyword.directive', foreground: '7b4fc9' },
      { token: 'invalid', foreground: 'c9372c', fontStyle: 'underline' },
      { token: 'variable.predefined', foreground: '11708a' },
      { token: 'type.identifier', foreground: '3b7a14' },
      { token: 'constant', foreground: '7b4fc9' },
      { token: 'identifier', foreground: '1d2730' },
      { token: 'number', foreground: 'b4501f' },
      { token: 'number.hex', foreground: 'b4501f' },
      { token: 'number.binary', foreground: 'b4501f' },
      { token: 'string', foreground: '3b7a14' },
      { token: 'delimiter', foreground: '75828c' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1d2730',
      'editorLineNumber.foreground': '#b3bcc3',
      'editorLineNumber.activeForeground': '#46545f',
      'editor.lineHighlightBackground': '#f4f6f8',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#cfe2f3',
      'editorCursor.foreground': '#9a6400',
      'editorGutter.background': '#ffffff',
      'editorWidget.background': '#f6f8fa',
      'editorWidget.border': '#cdd5db',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#cdd5db',
      'editorError.foreground': '#c9372c',
      'editorWarning.foreground': '#9a6400',
    },
  });
}
