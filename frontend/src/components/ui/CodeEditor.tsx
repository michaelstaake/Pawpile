import MonacoEditor, { type Monaco } from "@monaco-editor/react";

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  height?: string;
};

export default function CodeEditor({
  value,
  onChange,
  placeholder,
  maxLength,
  height = "19rem",
}: CodeEditorProps) {
  return (
    <div className="grid gap-1 overflow-hidden rounded-2xl">
      <MonacoEditor
        height={height}
        value={value}
        language="markdown"
        theme="pawpile-dark"
        options={{
          wordWrap: "on",
          fontSize: 13,
          lineHeight: 20,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          lineNumbers: "on",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 12, bottom: 12 },
          placeholder: placeholder || "",
          tabSize: 2,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true },
          formatOnPaste: true,
          formatOnType: true,
          renderWhitespace: "selection",
          stickyScroll: { enabled: false },
        }}
        onChange={(val) => onChange(val ?? "")}
        onMount={(editor: unknown, monaco: Monaco) => {
          monaco.editor.defineTheme("pawpile-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": "#0f0f0f",
              "editor.lineHighlightBackground": "#1a1a1a",
              "editorCursor.foreground": "#ffffff",
              "editor.foreground": "#e4e4e4",
            },
          });
          monaco.editor.setTheme("pawpile-dark");
        }}
      />
      {maxLength !== undefined && (
        <p className="text-xs text-black/45">{value.length} / {maxLength} characters</p>
      )}
    </div>
  );
}
