import {
  LocaleType,
  LogLevel,
  createUniver,
  mergeLocales,
  type FUniver,
  type IDisposable,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import type { FWorkbook, FWorksheet } from "@univerjs/sheets/facade";
import "@fontsource/noto-sans-myanmar/myanmar-400.css";
import "@univerjs/preset-sheets-core/lib/index.css";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { ProjectRow, ProjectStatus } from "@/types";
import { parseClipboardColumn } from "@/utils/clipboard";

const HEADER_ROW = 0;
const FIRST_DATA_ROW = 1;
const TEXT_COLUMN = 0;
const NAME_COLUMN = 1;
const FRAGMENT_COLUMN = 2;
const STATUS_COLUMN = 3;
const INITIAL_ROW_COUNT = 20;
const DATA_COLUMN_COUNT = 4;
const CONTENT_FONT_FAMILY = "Noto Sans Myanmar";
const BLOCKED_STRUCTURE_COMMANDS = new Set([
  "sheet.command.insert-row",
  "sheet.command.insert-col",
  "sheet.command.remove-row",
  "sheet.command.remove-col",
  "sheet.command.move-rows",
  "sheet.command.move-cols",
  "sheet.command.insert-range-move-down",
  "sheet.command.insert-range-move-right",
  "sheet.command.delete-range-move-up",
  "sheet.command.delete-range-move-left",
]);

type FocusColumn = "text" | "name";

export type ProjectSpreadsheetHandle = {
  replaceRows(rows: ProjectRow[]): void;
  focusRow(rowId: string, column?: FocusColumn): void;
  clearSelection(): void;
  readRows(): ProjectRow[];
};

type ProjectSpreadsheetProps = {
  rows: ProjectRow[];
  running: boolean;
  onRowsChange(rows: ProjectRow[]): void;
  onSelectionChange(ids: Set<string>): void;
};

type SheetRuntime = {
  api: FUniver;
  workbook: FWorkbook;
  worksheet: FWorksheet;
  dispose(): void;
};

type CellEditorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
};

type CellEditorState = {
  row: number;
  column: number;
  originalValue: string;
  value: string;
  rect: CellEditorRect;
};

export const ProjectSpreadsheet = forwardRef<
  ProjectSpreadsheetHandle,
  ProjectSpreadsheetProps
>(function ProjectSpreadsheet(
  { rows, running, onRowsChange, onSelectionChange },
  ref,
) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runtimeRef = useRef<SheetRuntime | null>(null);
  const rowsRef = useRef(rows);
  const runningRef = useRef(running);
  const onRowsChangeRef = useRef(onRowsChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const lastDataSignatureRef = useRef("");
  const syncTimerRef = useRef<number | null>(null);
  const internalWriteRef = useRef(false);
  const editorRef = useRef<CellEditorState | null>(null);
  const scrollRef = useRef({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [cellEditor, setCellEditor] = useState<CellEditorState | null>(null);

  rowsRef.current = rows;
  runningRef.current = running;
  onRowsChangeRef.current = onRowsChange;
  onSelectionChangeRef.current = onSelectionChange;

  function writeDerivedColumns(nextRows: ProjectRow[]): void {
    const worksheet = runtimeRef.current?.worksheet;
    if (!worksheet || !nextRows.length) return;
    internalWriteRef.current = true;
    try {
      worksheet
        .getRange(FIRST_DATA_ROW, FRAGMENT_COLUMN, nextRows.length, 2)
        .setValues(
          nextRows.map((row) => [
            fragmentCount(row.text),
            statusLabel(row),
          ]),
        );
    } finally {
      internalWriteRef.current = false;
    }
  }

  function replaceRows(nextRows: ProjectRow[]): void {
    const worksheet = runtimeRef.current?.worksheet;
    if (!worksheet) return;
    const normalized = nextRows.length ? nextRows : [createBlankProjectRow()];
    const requiredRowCount = Math.max(
      INITIAL_ROW_COUNT,
      FIRST_DATA_ROW + normalized.length,
    );
    ensureSheetRowCapacity(worksheet, requiredRowCount);
    const clearCount = Math.max(rowsRef.current.length, normalized.length, 1);
    internalWriteRef.current = true;
    try {
      worksheet
        .getRange(FIRST_DATA_ROW, TEXT_COLUMN, clearCount, DATA_COLUMN_COUNT)
        .clearContent();
      worksheet
        .getRange(FIRST_DATA_ROW, TEXT_COLUMN, normalized.length, DATA_COLUMN_COUNT)
        .setValues(
          normalized.map((row) => [
            row.text,
            row.name,
            fragmentCount(row.text),
            statusLabel(row),
          ]),
        );
      worksheet
        .getRange(FIRST_DATA_ROW, TEXT_COLUMN, normalized.length, 2)
        .setWrap(true)
        .setVerticalAlignment("top");
    } finally {
      internalWriteRef.current = false;
    }
    rowsRef.current = normalized;
    lastDataSignatureRef.current = dataSignature(normalized);
  }

  function readRows(requiredLastSheetRow = FIRST_DATA_ROW): ProjectRow[] {
    const worksheet = runtimeRef.current?.worksheet;
    if (!worksheet) return rowsRef.current;

    const maxDataRows = worksheet.getMaxRows() - FIRST_DATA_ROW;
    const boundedRequiredRow = Math.min(
      Math.max(requiredLastSheetRow, FIRST_DATA_ROW),
      worksheet.getMaxRows() - 1,
    );
    const scanCount = Math.min(
      Math.max(rowsRef.current.length + 20, boundedRequiredRow, 40),
      maxDataRows,
    );
    const values = worksheet
      .getRange(FIRST_DATA_ROW, TEXT_COLUMN, scanCount, DATA_COLUMN_COUNT)
      .getValues();
    let lastUsed = Math.max(0, boundedRequiredRow - FIRST_DATA_ROW);
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const [text, name] = values[index] ?? [];
      if (cellString(text) || cellString(name)) {
        lastUsed = Math.max(lastUsed, index);
        break;
      }
    }

    const nextRows: ProjectRow[] = [];

    for (let index = 0; index <= lastUsed; index += 1) {
      const [textValue, nameValue] = values[index] ?? [];
      const text = cellString(textValue);
      const name = cellString(nameValue);
      const previous = rowsRef.current[index];
      const unchanged = previous?.text === text && previous.name === name;
      nextRows.push({
        ...(previous ?? createBlankProjectRow()),
        text,
        name,
        status: unchanged ? previous.status : "idle",
        progress: unchanged ? previous.progress : 0,
        detail: unchanged ? previous.detail : "",
        error: unchanged ? previous.error : undefined,
      });
    }
    return nextRows.length ? nextRows : [createBlankProjectRow()];
  }

  function publishSheetRows(requiredLastSheetRow?: number): void {
    const nextRows = readRows(requiredLastSheetRow);
    const signature = dataSignature(nextRows);
    if (signature === lastDataSignatureRef.current) return;
    rowsRef.current = nextRows;
    lastDataSignatureRef.current = signature;
    writeDerivedColumns(nextRows);
    onRowsChangeRef.current(nextRows);
  }

  function schedulePublish(requiredLastSheetRow?: number): void {
    if (internalWriteRef.current) return;
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      publishSheetRows(requiredLastSheetRow);
    }, 0);
  }

  function isEditableCell(row: number, column: number): boolean {
    return row >= FIRST_DATA_ROW && column >= TEXT_COLUMN && column < FRAGMENT_COLUMN;
  }

  function measureEditorRect(row: number, column: number): CellEditorRect | null {
    const worksheet = runtimeRef.current?.worksheet;
    const shell = shellRef.current;
    const host = hostRef.current;
    if (!worksheet || !shell || !host) return null;

    const canvases = Array.from(host.querySelectorAll("canvas"));
    const canvas = canvases.reduce<HTMLCanvasElement | null>((largest, candidate) => {
      const area = candidate.clientWidth * candidate.clientHeight;
      const largestArea = largest ? largest.clientWidth * largest.clientHeight : 0;
      return area > largestArea ? candidate : largest;
    }, null);
    if (!canvas) return null;

    const cellRect = worksheet.getRange(row, column).getCellRect();
    const shellRect = shell.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const zoom = worksheet.getZoom();
    const scrollX = scrollRef.current.x;
    const scrollY = row > HEADER_ROW ? scrollRef.current.y : 0;
    const left = canvasRect.left - shellRect.left + cellRect.left * zoom - scrollX;
    const top = canvasRect.top - shellRect.top + cellRect.top * zoom - scrollY;
    const width = cellRect.width * zoom;
    const height = cellRect.height * zoom;

    return {
      left,
      top,
      width,
      height,
      visible:
        left + width > 0 &&
        top + height > 0 &&
        left < shell.clientWidth &&
        top < shell.clientHeight,
    };
  }

  function refreshEditorRect(): void {
    const current = editorRef.current;
    if (!current) return;
    const rect = measureEditorRect(current.row, current.column);
    if (!rect) return;
    const next = { ...current, rect };
    editorRef.current = next;
    setCellEditor(next);
  }

  function openCellEditor(row: number, column: number, replacement?: string): void {
    if (runningRef.current || !isEditableCell(row, column)) return;
    const worksheet = runtimeRef.current?.worksheet;
    if (!worksheet) return;

    const current = editorRef.current;
    if (current?.row === row && current.column === column) return;
    if (current) finishCellEditor(true);

    const originalValue = cellString(worksheet.getRange(row, column).getValue());
    const rect = measureEditorRect(row, column);
    if (!rect) return;
    const next: CellEditorState = {
      row,
      column,
      originalValue,
      value: replacement ?? originalValue,
      rect,
    };
    editorRef.current = next;
    setCellEditor(next);
    window.requestAnimationFrame(() => {
      const textarea = editorTextareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  function updateCellEditorValue(value: string): void {
    const current = editorRef.current;
    if (!current) return;
    const next = { ...current, value };
    editorRef.current = next;
    setCellEditor(next);
  }

  function finishCellEditor(
    confirm: boolean,
    nextCell?: { row: number; column: number },
  ): void {
    const current = editorRef.current;
    const worksheet = runtimeRef.current?.worksheet;
    if (!current || !worksheet) return;

    editorRef.current = null;
    setCellEditor(null);
    const value = current.value.replace(/\r\n?/g, "\n");
    if (confirm && value !== current.originalValue) {
      internalWriteRef.current = true;
      try {
        worksheet.getRange(current.row, current.column).setValues([[value]]);
      } finally {
        internalWriteRef.current = false;
      }
      const nextRows = readRows(current.row);
      rowsRef.current = nextRows;
      lastDataSignatureRef.current = dataSignature(nextRows);
      writeDerivedColumns(nextRows);
      onRowsChangeRef.current(nextRows);
    }

    const target = nextCell && isEditableCell(nextCell.row, nextCell.column)
      ? nextCell
      : { row: current.row, column: current.column };
    worksheet.getRange(target.row, target.column).activate();
    const selected = rowsRef.current[target.row - FIRST_DATA_ROW];
    onSelectionChangeRef.current(selected ? new Set([selected.id]) : new Set());
  }

  useImperativeHandle(ref, () => ({
    replaceRows(nextRows) {
      finishCellEditor(true);
      replaceRows(nextRows);
    },
    focusRow(rowId, column = "text") {
      finishCellEditor(true);
      const worksheet = runtimeRef.current?.worksheet;
      if (!worksheet) return;
      const rowIndex = rowsRef.current.findIndex((row) => row.id === rowId);
      if (rowIndex < 0) return;
      worksheet
        .getRange(
          FIRST_DATA_ROW + rowIndex,
          column === "name" ? NAME_COLUMN : TEXT_COLUMN,
        )
        .activate();
    },
    clearSelection() {
      finishCellEditor(true);
      runtimeRef.current?.worksheet.getRange(FIRST_DATA_ROW, TEXT_COLUMN).activate();
      onSelectionChangeRef.current(new Set());
    },
    readRows() {
      finishCellEditor(true);
      const nextRows = readRows();
      rowsRef.current = nextRows;
      lastDataSignatureRef.current = dataSignature(nextRows);
      return nextRows;
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.ZH_CN,
      locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN) },
      logLevel: LogLevel.ERROR,
      presets: [
        UniverSheetsCorePreset({
          container: host,
          header: false,
          toolbar: true,
          ribbonType: "simple",
          formulaBar: true,
          footer: { sheetBar: false, statisticBar: true, zoomSlider: true },
          statusBarStatistic: true,
          contextMenu: false,
        }),
      ],
    });
    const workbook = univerAPI.createUniverSheet({ name: "音频项目" });
    const worksheet = workbook.getActiveSheet();
    worksheet.setName("项目");
    worksheet.setRowCount(INITIAL_ROW_COUNT);
    worksheet.setColumnCount(DATA_COLUMN_COUNT);
    worksheet.setFrozenRows(1);
    worksheet.setColumnWidth(TEXT_COLUMN, 620);
    worksheet.setColumnWidth(NAME_COLUMN, 220);
    worksheet.setColumnWidth(FRAGMENT_COLUMN, 110);
    worksheet.setColumnWidth(STATUS_COLUMN, 260);
    worksheet.setRowHeight(HEADER_ROW, 34);
    worksheet.setRowHeights(FIRST_DATA_ROW, INITIAL_ROW_COUNT - 1, 64);
    worksheet
      .getRange(HEADER_ROW, TEXT_COLUMN, 1, DATA_COLUMN_COUNT)
      .setValues([["文案内容（单元格内每行 = 一条字幕）", "项目名称", "片段", "状态"]])
      .setFontWeight("bold")
      .setFontColor("#343a46")
      .setBackgroundColor("#f3f5f8")
      .setVerticalAlignment("middle");
    worksheet
      .getRange(HEADER_ROW, FRAGMENT_COLUMN, 1, 2)
      .setHorizontalAlignment("center");
    worksheet
      .getRange(FIRST_DATA_ROW, TEXT_COLUMN, INITIAL_ROW_COUNT - 1, 2)
      .setWrap(true)
      .setFontFamily(CONTENT_FONT_FAMILY)
      .setVerticalAlignment("top");
    worksheet
      .getRange(FIRST_DATA_ROW, FRAGMENT_COLUMN, INITIAL_ROW_COUNT - 1, 2)
      .setBackgroundColor("#fafbfc")
      .setFontColor("#687284")
      .setWrap(true)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    const disposables: IDisposable[] = [];
    disposables.push(
      univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (event) => {
        if (BLOCKED_STRUCTURE_COMMANDS.has(event.id)) event.cancel = true;
      }),
      univerAPI.addEvent(univerAPI.Event.BeforeSheetEditStart, (event) => {
        event.cancel = true;
        if (runningRef.current || !isEditableCell(event.row, event.column)) return;
        window.queueMicrotask(() => openCellEditor(event.row, event.column));
      }),
      univerAPI.addEvent(univerAPI.Event.BeforeClipboardPaste, (event) => {
        const range = worksheet.getActiveRange()?.getRange();
        if (!range) return;
        if (
          range.startRow === HEADER_ROW ||
          range.startColumn >= FRAGMENT_COLUMN
        ) {
          event.cancel = true;
          return;
        }
      }),
      univerAPI.addEvent(univerAPI.Event.ClipboardPasted, () => schedulePublish()),
      univerAPI.addEvent(univerAPI.Event.Scroll, ({ scrollX, scrollY }) => {
        scrollRef.current = { x: scrollX, y: scrollY };
        window.requestAnimationFrame(refreshEditorRect);
      }),
      univerAPI.addEvent(univerAPI.Event.SheetZoomChanged, () => {
        window.requestAnimationFrame(refreshEditorRect);
      }),
      univerAPI.addEvent(univerAPI.Event.SheetSkeletonChanged, () => {
        window.requestAnimationFrame(refreshEditorRect);
      }),
      univerAPI.addEvent(univerAPI.Event.SelectionChanged, ({ selections }) => {
        const dataSelections = selections.filter((selection) => selection.endRow >= FIRST_DATA_ROW);
        if (!dataSelections.length) {
          onSelectionChangeRef.current(new Set());
          return;
        }
        const lastSelectedRow = Math.min(
          Math.max(...dataSelections.map((selection) => selection.endRow)),
          worksheet.getMaxRows() - 1,
        );
        const current = readRows(lastSelectedRow);
        if (dataSignature(current) !== lastDataSignatureRef.current) {
          rowsRef.current = current;
          lastDataSignatureRef.current = dataSignature(current);
          onRowsChangeRef.current(current);
        }
        const selected = new Set<string>();
        for (const selection of dataSelections) {
          for (
            let row = Math.max(selection.startRow, FIRST_DATA_ROW);
            row <= selection.endRow;
            row += 1
          ) {
            const project = current[row - FIRST_DATA_ROW];
            if (project) selected.add(project.id);
          }
        }
        onSelectionChangeRef.current(selected);
      }),
      univerAPI.onCommandExecuted(() => {
        schedulePublish();
        window.requestAnimationFrame(refreshEditorRect);
      }),
    );

    runtimeRef.current = {
      api: univerAPI,
      workbook,
      worksheet,
      dispose() {
        for (const disposable of disposables) disposable.dispose();
        workbook.dispose();
        univer.dispose();
      },
    };

    const handleGridPointerDown = (event: PointerEvent) => {
      if (runningRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (editorRef.current) finishCellEditor(true);
    };
    const handleGridKeyDown = (event: KeyboardEvent) => {
      if (runningRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        editorRef.current ||
        event.defaultPrevented ||
        event.isComposing
      ) {
        return;
      }
      const range = worksheet.getActiveRange()?.getRange();
      if (
        !range ||
        range.startRow !== range.endRow ||
        range.startColumn !== range.endColumn ||
        !isEditableCell(range.startRow, range.startColumn)
      ) {
        return;
      }

      const opensExistingValue = event.key === "Enter" || event.key === "F2";
      const replacesValue =
        event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!opensExistingValue && !replacesValue) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      openCellEditor(
        range.startRow,
        range.startColumn,
        replacesValue ? event.key : undefined,
      );
    };
    const captureColumnPaste = (event: ClipboardEvent) => {
      if (runningRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.defaultPrevented) return;
      if (editorRef.current) return;
      const range = worksheet.getActiveRange()?.getRange();
      if (
        !range ||
        range.startRow === HEADER_ROW ||
        range.startColumn >= FRAGMENT_COLUMN
      ) {
        return;
      }
      const plainText = event.clipboardData?.getData("text/plain") ?? "";
      const htmlText = event.clipboardData?.getData("text/html") ?? "";
      const columnValues = parseClipboardColumn(plainText, htmlText);
      if (columnValues === null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (!columnValues.length) return;
      ensureSheetRowCapacity(
        worksheet,
        range.startRow + columnValues.length,
      );
      const valuesToPaste = columnValues;
      const lastPastedRow = range.startRow + valuesToPaste.length - 1;

      event.preventDefault();
      event.stopImmediatePropagation();
      worksheet
        .getRange(range.startRow, range.startColumn, valuesToPaste.length, 1)
        .setValues(valuesToPaste.map((value) => [value]));
      schedulePublish(lastPastedRow);
      window.setTimeout(() => {
        const projects = readRows(lastPastedRow);
        const selected = new Set<string>();
        for (let row = range.startRow; row <= lastPastedRow; row += 1) {
          const project = projects[row - FIRST_DATA_ROW];
          if (project) selected.add(project.id);
        }
        onSelectionChangeRef.current(selected);
      }, 0);
    };
    host.addEventListener("pointerdown", handleGridPointerDown, true);
    host.addEventListener("keydown", handleGridKeyDown, true);
    host.addEventListener("paste", captureColumnPaste, true);

    replaceRows(rowsRef.current);
    worksheet.getRange(FIRST_DATA_ROW, TEXT_COLUMN).activate();
    setReady(true);

    return () => {
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      host.removeEventListener("pointerdown", handleGridPointerDown, true);
      host.removeEventListener("keydown", handleGridKeyDown, true);
      host.removeEventListener("paste", captureColumnPaste, true);
      editorRef.current = null;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
    // Univer owns this subtree for the lifetime of the workbench.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (running) finishCellEditor(true);
  }, [running]);

  useEffect(() => {
    if (!ready) return;
    const currentData = dataSignature(rowsRef.current);
    const incomingData = dataSignature(rows);
    rowsRef.current = rows;
    if (currentData === incomingData) {
      writeDerivedColumns(rows);
    }
  }, [ready, rows]);

  return (
    <div
      ref={shellRef}
      className="project-spreadsheet-shell"
      aria-busy={running}
    >
      {!ready && <div className="spreadsheet-loading">正在启动电子表格…</div>}
      <div ref={hostRef} className="project-spreadsheet" aria-label="音频项目电子表格" />
      {cellEditor && (
        <textarea
          ref={editorTextareaRef}
          data-testid="sheet-cell-editor"
          className="sheet-cell-editor"
          aria-label={`编辑第 ${cellEditor.row + 1} 行${cellEditor.column === TEXT_COLUMN ? "文案" : "项目名称"}`}
          value={cellEditor.value}
          spellCheck={false}
          style={{
            left: cellEditor.rect.left,
            top: cellEditor.rect.top,
            width: cellEditor.rect.width,
            height: cellEditor.rect.height,
            visibility: cellEditor.rect.visible ? "visible" : "hidden",
          }}
          onChange={(event) => updateCellEditorValue(event.target.value)}
          onBlur={() => finishCellEditor(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              finishCellEditor(false);
              return;
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              finishCellEditor(true);
              return;
            }
            if (event.key !== "Tab") return;
            event.preventDefault();
            const direction = event.shiftKey ? -1 : 1;
            let nextRow = cellEditor.row;
            let nextColumn = cellEditor.column + direction;
            if (nextColumn >= FRAGMENT_COLUMN) {
              nextColumn = TEXT_COLUMN;
              nextRow += 1;
            } else if (nextColumn < TEXT_COLUMN) {
              nextColumn = NAME_COLUMN;
              nextRow -= 1;
            }
            finishCellEditor(true, {
              row: Math.max(FIRST_DATA_ROW, nextRow),
              column: nextColumn,
            });
          }}
          onPaste={(event) => event.stopPropagation()}
          onCopy={(event) => event.stopPropagation()}
          onCut={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
});

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function fragmentCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function statusLabel(row: ProjectRow): string {
  const labels: Record<ProjectStatus, string> = {
    idle: "未处理",
    queued: "等待处理",
    processing: `生成中 ${Math.round(row.progress)}%`,
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
  };
  const detail = row.error || row.detail;
  return detail ? `${labels[row.status]} · ${detail}` : labels[row.status];
}

function ensureSheetRowCapacity(
  worksheet: FWorksheet,
  requiredRowCount: number,
): void {
  const currentRowCount = worksheet.getMaxRows();
  if (currentRowCount >= requiredRowCount) return;

  const addedRowCount = requiredRowCount - currentRowCount;
  worksheet.setRowCount(requiredRowCount);
  worksheet.setRowHeights(currentRowCount, addedRowCount, 64);
  worksheet
    .getRange(currentRowCount, TEXT_COLUMN, addedRowCount, 2)
    .setWrap(true)
    .setFontFamily(CONTENT_FONT_FAMILY)
    .setVerticalAlignment("top");
  worksheet
    .getRange(currentRowCount, FRAGMENT_COLUMN, addedRowCount, 2)
    .setBackgroundColor("#fafbfc")
    .setFontColor("#687284")
    .setWrap(true)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

function dataSignature(rows: ProjectRow[]): string {
  return rows.map((row) => `${row.id}\u0000${row.text}\u0000${row.name}`).join("\u0001");
}

function createBlankProjectRow(id: string = crypto.randomUUID()): ProjectRow {
  return {
    id,
    text: "",
    name: "",
    status: "idle",
    progress: 0,
    detail: "",
  };
}
