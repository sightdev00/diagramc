import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import { canvasTheme } from "./canvasThemes";
import type { DiagramDocument, DiagramElement, DiagramRelation } from "./types";

export interface ElementPatch {
  label?: string;
  description?: string;
  semanticType?: string;
  parentId?: string;
  shape?: string;
  fillColor?: string;
  strokeColor?: string;
  textColor?: string;
  width?: number;
  height?: number;
  fontSize?: number;
  fontWeight?: number;
  strokeWidth?: number;
}

export interface RelationPatch {
  label?: string;
  semanticType?: string;
  kind?: DiagramRelation["kind"];
  sourceId?: string;
  targetId?: string;
  sourcePortId?: string;
  targetPortId?: string;
  strokeColor?: string;
  textColor?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontWeight?: number;
  lineStyle?: string;
}

interface InspectorProps {
  document?: DiagramDocument;
  element?: DiagramElement;
  elements?: DiagramElement[];
  relation?: DiagramRelation;
  groups: DiagramElement[];
  onUpdateElement: (patch: ElementPatch) => void;
  onUpdateSvgSource?: (svgSource: string) => void;
  onUpdateElements: (patch: ElementPatch) => void;
  onUpdateRelation: (patch: RelationPatch) => void;
  onDelete: () => void;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function color(value: unknown, fallback: string) {
  const candidate = text(value);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}

function SvgSourceEditor({
  elementId,
  source,
  onApply,
}: {
  elementId: string;
  source: string;
  onApply: (source: string) => void;
}) {
  const [draft, setDraft] = useState(source);
  useEffect(() => setDraft(source), [elementId, source]);
  const apply = () => onApply(draft);
  return (
    <>
      <label>
        SVG 源码
        <textarea
          className="svg-source-editor"
          rows={18}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={apply}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
      </label>
      <button
        className="inspector-theme-reset"
        disabled={draft === source}
        onMouseDown={(event) => event.preventDefault()}
        onClick={apply}
      >
        应用 SVG 源码
      </button>
      <div className="batch-tip">
        点击“应用 SVG 源码”或按 Ctrl/Cmd + Enter 可立即刷新画布。
      </div>
    </>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onInput,
}: {
  label: string;
  value: unknown;
  fallback: string;
  onInput: (value: string) => void;
}) {
  const current = color(value, fallback);
  const handleInput = (event: FormEvent<HTMLInputElement>) =>
    onInput(event.currentTarget.value);
  return (
    <label>
      {label}
      <span className="color-control">
        <input type="color" value={current} onInput={handleInput} />
        <code>{current.toUpperCase()}</code>
      </span>
    </label>
  );
}

function StrokeWidthField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: unknown;
  fallback: number;
  onChange: (value: number) => void;
}) {
  const current =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return (
    <label>
      {label}
      <span className="stroke-width-control">
        <input
          aria-label={`${label}滑块`}
          type="range"
          min="0.5"
          max="12"
          step="0.1"
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          key={`${label}-${current}`}
          aria-label={label}
          type="number"
          min="0.5"
          max="12"
          step="0.1"
          defaultValue={current}
          onKeyDown={blurOnEnter}
          onBlur={(event) => onChange(Number(event.target.value))}
        />
      </span>
    </label>
  );
}

function ShapeOptions({ includeKeep = false }: { includeKeep?: boolean }) {
  return (
    <>
      {includeKeep && <option value="">保持各自形状</option>}
      <optgroup label="基础">
        <option value="rounded">圆角矩形</option>
        <option value="rectangle">矩形</option>
        <option value="capsule">胶囊 / 起止</option>
        <option value="circle">圆形</option>
        <option value="ellipse">椭圆</option>
      </optgroup>
      <optgroup label="流程图">
        <option value="diamond">判断菱形</option>
        <option value="hexagon">六边形 / 准备</option>
        <option value="parallelogram">平行四边形 / 输入输出</option>
        <option value="trapezoid">梯形 / 手工操作</option>
        <option value="subprocess">子流程</option>
        <option value="database">数据库</option>
        <option value="document">文档</option>
      </optgroup>
      <optgroup label="表达">
        <option value="note">便签</option>
        <option value="cloud">云</option>
      </optgroup>
    </>
  );
}

function sameValue(values: unknown[]) {
  if (!values.length) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

function BatchInspector({
  document,
  elements,
  onUpdate,
  onDelete,
}: {
  document?: DiagramDocument;
  elements: DiagramElement[];
  onUpdate: (patch: ElementPatch) => void;
  onDelete: () => void;
}) {
  const theme = canvasTheme(document?.presentation.theme);
  const revision = document?.document.revision ?? 0;
  const selectionKey = elements.map((element) => element.id).join("|");
  const shapes = elements.filter((element) => element.kind !== "group");
  const sizes = elements.map(
    (element) => document?.layouts.default?.overrides[element.id]?.size,
  );
  const commonWidth = sameValue(sizes.map((size) => size?.width));
  const commonHeight = sameValue(sizes.map((size) => size?.height));
  const commonFontSize = sameValue(
    elements.map((element) => element.data.fontSize),
  );
  const commonStrokeWidth = sameValue(
    elements.map((element) => element.data.strokeWidth),
  );
  const commonFill = sameValue(
    elements.map((element) => element.data.fillColor),
  );
  const commonStroke = sameValue(
    elements.map((element) => element.data.strokeColor),
  );
  const commonText = sameValue(
    elements.map((element) => element.data.textColor),
  );

  const updateNumber = (
    field: "width" | "height" | "fontSize" | "strokeWidth",
    value: string,
  ) => {
    if (!value.trim()) return;
    const number = Number(value);
    if (Number.isFinite(number)) onUpdate({ [field]: number });
  };

  return (
    <div className="inspector batch-inspector">
      <div className="selection-kicker">已选择 {elements.length} 个框</div>
      <div className="batch-tip">
        以下修改会一次应用到所有已选框。空白或“保持各自”表示不改变原值。
      </div>
      <div className="field-grid">
        <label>
          统一字号
          <input
            key={`batch-font-${selectionKey}-${revision}`}
            type="number"
            min="8"
            max="72"
            placeholder="混合"
            defaultValue={
              typeof commonFontSize === "number" ? commonFontSize : ""
            }
            onKeyDown={blurOnEnter}
            onBlur={(event) => updateNumber("fontSize", event.target.value)}
          />
        </label>
        <label>
          统一字重
          <select
            value=""
            onChange={(event) =>
              event.target.value &&
              onUpdate({ fontWeight: Number(event.target.value) })
            }
          >
            <option value="">保持各自</option>
            <option value="400">常规 400</option>
            <option value="500">中等 500</option>
            <option value="600">半粗 600</option>
            <option value="700">粗体 700</option>
          </select>
        </label>
      </div>
      <label>
        统一形状
        <select
          value=""
          disabled={!shapes.length}
          onChange={(event) =>
            event.target.value && onUpdate({ shape: event.target.value })
          }
        >
          <ShapeOptions includeKeep />
        </select>
      </label>
      <div className="field-grid">
        <label>
          统一宽度
          <input
            key={`batch-width-${selectionKey}-${revision}`}
            type="number"
            min="80"
            max="800"
            placeholder="混合"
            defaultValue={typeof commonWidth === "number" ? commonWidth : ""}
            onKeyDown={blurOnEnter}
            onBlur={(event) => updateNumber("width", event.target.value)}
          />
        </label>
        <label>
          统一高度
          <input
            key={`batch-height-${selectionKey}-${revision}`}
            type="number"
            min="40"
            max="500"
            placeholder="混合"
            defaultValue={typeof commonHeight === "number" ? commonHeight : ""}
            onKeyDown={blurOnEnter}
            onBlur={(event) => updateNumber("height", event.target.value)}
          />
        </label>
      </div>
      <label>
        统一边框粗细
        <input
          key={`batch-stroke-width-${selectionKey}-${revision}`}
          type="number"
          min="0.5"
          max="12"
          step="0.1"
          placeholder="混合"
          defaultValue={
            typeof commonStrokeWidth === "number" ? commonStrokeWidth : ""
          }
          onKeyDown={blurOnEnter}
          onBlur={(event) => updateNumber("strokeWidth", event.target.value)}
        />
      </label>
      <div className="field-grid color-grid">
        <ColorField
          label="统一填充"
          value={commonFill}
          fallback={theme.defaultNode.fill}
          onInput={(value) => onUpdate({ fillColor: value })}
        />
        <ColorField
          label="统一边框"
          value={commonStroke}
          fallback={theme.defaultNode.stroke}
          onInput={(value) => onUpdate({ strokeColor: value })}
        />
        <ColorField
          label="统一文字"
          value={commonText}
          fallback={theme.text}
          onInput={(value) => onUpdate({ textColor: value })}
        />
      </div>
      <button
        className="inspector-theme-reset"
        onClick={() =>
          onUpdate({ fillColor: "", strokeColor: "", textColor: "" })
        }
      >
        全部恢复当前主题配色
      </button>
      <button className="danger inspector-delete" onClick={onDelete}>
        删除所选 {elements.length} 个框
      </button>
    </div>
  );
}

export function Inspector({
  document,
  element,
  elements = [],
  relation,
  groups,
  onUpdateElement,
  onUpdateSvgSource,
  onUpdateElements,
  onUpdateRelation,
  onDelete,
}: InspectorProps) {
  const theme = canvasTheme(document?.presentation.theme);
  if (elements.length > 1) {
    return (
      <BatchInspector
        document={document}
        elements={elements}
        onUpdate={onUpdateElements}
        onDelete={onDelete}
      />
    );
  }
  if (!element && !relation) {
    return (
      <div className="empty-panel">
        <div className="empty-icon">⌁</div>
        <strong>选择框或连线</strong>
        <p>
          单击选择元素；双击框或连线可直接编辑文字，也可以在这里修改完整属性。
        </p>
      </div>
    );
  }

  if (relation) {
    const linkable =
      document?.elements.filter((item) => item.kind !== "group") ?? [];
    return (
      <div className="inspector">
        <div className="selection-kicker">relation · {relation.id}</div>
        <label>
          显示名称
          <input
            key={`relation-label-${relation.id}`}
            defaultValue={text(relation.data.label)}
            onBlur={(event) => onUpdateRelation({ label: event.target.value })}
          />
        </label>
        <label>
          语义类型
          <input
            key={`relation-type-${relation.id}`}
            defaultValue={relation.semanticType}
            onBlur={(event) =>
              onUpdateRelation({ semanticType: event.target.value })
            }
          />
        </label>
        <div className="field-grid">
          <label>
            起点
            <select
              value={relation.source.elementId}
              onChange={(event) =>
                onUpdateRelation({ sourceId: event.target.value })
              }
            >
              {linkable.map((item) => (
                <option key={item.id} value={item.id}>
                  {text(item.data.label, item.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            终点
            <select
              value={relation.target.elementId}
              onChange={(event) =>
                onUpdateRelation({ targetId: event.target.value })
              }
            >
              {linkable.map((item) => (
                <option key={item.id} value={item.id}>
                  {text(item.data.label, item.id)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-grid">
          <label>
            起点锚点
            <select
              value={relation.source.portId ?? ""}
              onChange={(event) =>
                onUpdateRelation({ sourcePortId: event.target.value })
              }
            >
              <option value="">自动</option>
              <option value="top">上</option>
              <option value="right">右</option>
              <option value="bottom">下</option>
              <option value="left">左</option>
            </select>
          </label>
          <label>
            终点锚点
            <select
              value={relation.target.portId ?? ""}
              onChange={(event) =>
                onUpdateRelation({ targetPortId: event.target.value })
              }
            >
              <option value="">自动</option>
              <option value="top">上</option>
              <option value="right">右</option>
              <option value="bottom">下</option>
              <option value="left">左</option>
            </select>
          </label>
        </div>
        <div className="field-grid">
          <label>
            方向
            <select
              value={relation.kind}
              onChange={(event) =>
                onUpdateRelation({
                  kind: event.target.value as DiagramRelation["kind"],
                })
              }
            >
              <option value="directed">有向</option>
              <option value="undirected">无向</option>
            </select>
          </label>
          <label>
            线型
            <select
              value={text(relation.data.lineStyle, "solid")}
              onChange={(event) =>
                onUpdateRelation({ lineStyle: event.target.value })
              }
            >
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
            </select>
          </label>
        </div>
        <div className="field-grid">
          <label>
            标签字号
            <input
              key={`relation-font-size-${relation.id}-${document?.document.revision}`}
              type="number"
              min="8"
              max="72"
              defaultValue={Number(relation.data.fontSize ?? 11)}
              onKeyDown={blurOnEnter}
              onBlur={(event) =>
                onUpdateRelation({ fontSize: Number(event.target.value) })
              }
            />
          </label>
          <label>
            标签字重
            <select
              value={Number(
                relation.data.fontWeight ?? Math.min(theme.nodeFontWeight, 600),
              )}
              onChange={(event) =>
                onUpdateRelation({ fontWeight: Number(event.target.value) })
              }
            >
              <option value="400">常规 400</option>
              <option value="500">中等 500</option>
              <option value="600">半粗 600</option>
              <option value="700">粗体 700</option>
            </select>
          </label>
        </div>
        <div className="field-grid">
          <ColorField
            label="线条颜色"
            value={relation.data.strokeColor}
            fallback={theme.edge}
            onInput={(value) => onUpdateRelation({ strokeColor: value })}
          />
          <ColorField
            label="标签文字"
            value={relation.data.textColor}
            fallback={theme.edgeLabel}
            onInput={(value) => onUpdateRelation({ textColor: value })}
          />
        </div>
        <StrokeWidthField
          label="连线粗细"
          value={relation.data.strokeWidth}
          fallback={
            relation.semanticType.endsWith("critical")
              ? Math.max(2.2, theme.edgeWidth)
              : theme.edgeWidth
          }
          onChange={(value) => onUpdateRelation({ strokeWidth: value })}
        />
        <button
          className="inspector-theme-reset"
          onClick={() => onUpdateRelation({ strokeColor: "", textColor: "" })}
        >
          恢复当前主题配色
        </button>
        <button className="danger inspector-delete" onClick={onDelete}>
          删除这条连线
        </button>
      </div>
    );
  }

  const override = document?.layouts.default?.overrides[element!.id];
  if (
    element!.kind === "image" &&
    element!.semanticType === "svg.imported.fidelity"
  ) {
    return (
      <div className="inspector">
        <div className="selection-kicker">保真 SVG · 可编辑源码</div>
        <div className="batch-tip">
          此模式保留原始矢量外观。修改下方 SVG
          源码后，输入框失焦时应用；可用宽高调整整张图。
        </div>
        <div className="field-grid">
          <label>
            宽度
            <input
              type="number"
              min="80"
              defaultValue={override?.size?.width ?? 800}
              onKeyDown={blurOnEnter}
              onBlur={(event) =>
                onUpdateElement({ width: Number(event.target.value) })
              }
            />
          </label>
          <label>
            高度
            <input
              type="number"
              min="40"
              defaultValue={override?.size?.height ?? 600}
              onKeyDown={blurOnEnter}
              onBlur={(event) =>
                onUpdateElement({ height: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <SvgSourceEditor
          elementId={element!.id}
          source={text(element!.data.svgSource)}
          onApply={(source) => onUpdateSvgSource?.(source)}
        />
        <button className="danger inspector-delete" onClick={onDelete}>
          删除这个 SVG
        </button>
      </div>
    );
  }
  const selectedShape = text(element!.data.shape, "rounded");
  const semanticRole = element!.semanticType.split(".").at(-1) ?? "default";
  const visualRole =
    selectedShape === "diamond"
      ? "decision"
      : selectedShape === "ellipse" || selectedShape === "database"
        ? "data"
        : selectedShape;
  const themeNode =
    theme.roles[semanticRole] ?? theme.roles[visualRole] ?? theme.defaultNode;
  return (
    <div className="inspector">
      <div className="selection-kicker">
        {element!.kind} · {element!.id}
      </div>
      <label>
        显示名称
        <input
          key={`label-${element!.id}-${document?.document.revision}`}
          defaultValue={text(element!.data.label)}
          onBlur={(event) => onUpdateElement({ label: event.target.value })}
        />
      </label>
      <label>
        说明
        <textarea
          rows={3}
          key={`description-${element!.id}-${document?.document.revision}`}
          defaultValue={text(element!.data.description)}
          onBlur={(event) =>
            onUpdateElement({ description: event.target.value })
          }
        />
      </label>
      <label>
        语义类型
        <input
          key={`type-${element!.id}-${document?.document.revision}`}
          defaultValue={element!.semanticType}
          onBlur={(event) =>
            onUpdateElement({ semanticType: event.target.value })
          }
        />
      </label>
      <div className="field-grid">
        <label>
          形状
          <select
            value={text(element!.data.shape, "rounded")}
            disabled={element!.kind === "group"}
            onChange={(event) => onUpdateElement({ shape: event.target.value })}
          >
            <ShapeOptions />
          </select>
        </label>
        <label>
          所属分组
          <select
            value={element!.parentId ?? ""}
            disabled={element!.kind === "group"}
            onChange={(event) =>
              onUpdateElement({ parentId: event.target.value })
            }
          >
            <option value="">无分组</option>
            {groups
              .filter((group) => group.id !== element!.id)
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {text(group.data.label, group.id)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="field-grid">
        <label>
          宽度
          <input
            key={`width-${element!.id}-${override?.size?.width ?? "default"}`}
            type="number"
            min="80"
            max="800"
            defaultValue={override?.size?.width ?? 220}
            onKeyDown={blurOnEnter}
            onBlur={(event) =>
              onUpdateElement({ width: Number(event.target.value) })
            }
          />
        </label>
        <label>
          高度
          <input
            key={`height-${element!.id}-${override?.size?.height ?? "default"}`}
            type="number"
            min="40"
            max="500"
            defaultValue={override?.size?.height ?? 76}
            onKeyDown={blurOnEnter}
            onBlur={(event) =>
              onUpdateElement({ height: Number(event.target.value) })
            }
          />
        </label>
      </div>
      <div className="field-grid">
        <label>
          字号
          <input
            key={`font-size-${element!.id}-${document?.document.revision}`}
            type="number"
            min="8"
            max="72"
            defaultValue={Number(
              element!.data.fontSize ?? (element!.kind === "group" ? 11 : 14),
            )}
            onKeyDown={blurOnEnter}
            onBlur={(event) =>
              onUpdateElement({ fontSize: Number(event.target.value) })
            }
          />
        </label>
        <label>
          字重
          <select
            value={Number(
              element!.data.fontWeight ??
                (element!.kind === "group" ? 700 : 600),
            )}
            onChange={(event) =>
              onUpdateElement({ fontWeight: Number(event.target.value) })
            }
          >
            <option value="400">常规 400</option>
            <option value="500">中等 500</option>
            <option value="600">半粗 600</option>
            <option value="700">粗体 700</option>
          </select>
        </label>
      </div>
      <div className="field-grid color-grid">
        <ColorField
          label="填充"
          value={element!.data.fillColor}
          fallback={themeNode.fill}
          onInput={(value) => onUpdateElement({ fillColor: value })}
        />
        <ColorField
          label="边框"
          value={element!.data.strokeColor}
          fallback={themeNode.stroke}
          onInput={(value) => onUpdateElement({ strokeColor: value })}
        />
        <ColorField
          label="文字"
          value={element!.data.textColor}
          fallback={theme.text}
          onInput={(value) => onUpdateElement({ textColor: value })}
        />
      </div>
      <StrokeWidthField
        label="边框粗细"
        value={element!.data.strokeWidth}
        fallback={theme.strokeWidth}
        onChange={(value) => onUpdateElement({ strokeWidth: value })}
      />
      <button
        className="inspector-theme-reset"
        onClick={() =>
          onUpdateElement({ fillColor: "", strokeColor: "", textColor: "" })
        }
      >
        恢复当前主题配色
      </button>
      <button className="danger inspector-delete" onClick={onDelete}>
        删除这个元素
      </button>
    </div>
  );
}
