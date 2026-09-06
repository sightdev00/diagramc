import { useState } from "react";

export type SourceImportKind = "mermaid" | "svg";

const COPY: Record<
  SourceImportKind,
  { title: string; label: string; hint: string; placeholder: string }
> = {
  mermaid: {
    title: "\u5e94\u7528 Mermaid \u6e90\u7801",
    label: "Mermaid \u6e90\u7801",
    hint: "\u7c98\u8d34 AI \u751f\u6210\u7684 flowchart/graph \u6e90\u7801\uff0c\u5c06\u751f\u6210\u4e00\u5f20\u53ef\u7f16\u8f91\u7684\u65b0\u56fe\u3002",
    placeholder:
      "flowchart TD\n  A[\u8f93\u5165] --> B{\u5224\u65ad}\n  B -->|\u662f| C[\u8f93\u51fa]",
  },
  svg: {
    title: "\u5e94\u7528 SVG \u6e90\u7801",
    label: "SVG \u6e90\u7801",
    hint: "\u7c98\u8d34 SVG \u6e90\u7801\uff0c\u5c06\u4ee5\u4fdd\u771f\u6a21\u5f0f\u5bfc\u5165\u4e3a\u53ef\u4fee\u6539\u7684\u7f20\u91cf\u56fe\u5bf9\u8c61\u3002",
    placeholder: '<svg viewBox="0 0 640 360">...</svg>',
  },
};

export function SourceImportDialog({
  kind,
  onApply,
  onClose,
}: {
  kind: SourceImportKind;
  onApply: (source: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const copy = COPY[kind];
  const apply = () => {
    if (!source.trim()) {
      setError("\u8bf7\u5148\u7c98\u8d34\u6e90\u7801");
      return;
    }
    try {
      onApply(source);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="source-import-backdrop" role="presentation">
      <section
        aria-labelledby="source-import-title"
        aria-modal="true"
        className="source-import-dialog"
        role="dialog"
      >
        <div className="source-import-heading">
          <div>
            <strong id="source-import-title">{copy.title}</strong>
            <small>{copy.hint}</small>
          </div>
          <button
            aria-label={"\u5173\u95ed\u6e90\u7801\u5bfc\u5165"}
            className="quiet"
            onClick={onClose}
          >
            {"\u5173\u95ed"}
          </button>
        </div>
        <label>
          {copy.label}
          <textarea
            autoFocus
            placeholder={copy.placeholder}
            rows={16}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
          />
        </label>
        {error && <div className="source-import-error">{error}</div>}
        <div className="source-import-actions">
          <small>{"Ctrl/Cmd + Enter \u53ef\u76f4\u63a5\u5e94\u7528"}</small>
          <button className="primary" onClick={apply}>
            {"\u5e94\u7528\u4e3a\u65b0\u56fe"}
          </button>
        </div>
      </section>
    </div>
  );
}
