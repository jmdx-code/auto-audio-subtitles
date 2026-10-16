import {
  AlertCircle,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  Copy,
  FolderOpen,
  Headphones,
  ListOrdered,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AudioEngine } from "@/audio/AudioEngine";
import { BatchRunner, formatPitch, formatRate } from "@/jobs/BatchRunner";
import { TaskController } from "@/jobs/TaskController";
import { EdgeTtsProvider } from "@/providers/edge/EdgeTtsProvider";
import { defaultSettings } from "@/schema/settings";
import {
  ProjectSpreadsheet,
  type ProjectSpreadsheetHandle,
} from "@/scopes/workbench/ProjectSpreadsheet";
import {
  ensureDirectoryPermission,
  getSavedDirectoryHandle,
  saveDirectoryHandle,
} from "@/storage/directoryHandle";
import { findExistingOutputFolders } from "@/storage/outputDirectory";
import { loadSettings, saveSettings } from "@/storage/settings";
import { cleanupAllTempJobs } from "@/storage/tempStore";
import type { AppSettings, ProjectRow, VoiceInfo } from "@/types";
import { buildJobs } from "@/utils/naming";
import { buildOrganizerPrompt, cleanOrganizerResult } from "@/organizer/prompt";
import { discoverStudioModels, openStudio, organizeInStudio, listStudioTabs, selectStudioTab, getSelectedStudioTabId, type StudioTabOption } from "@/organizer/studioClient";
import type { StudioModelOption } from "@/organizer/types";

type Toast = { id: number; kind: "success" | "error" | "info"; message: string };
type Confirmation = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive: boolean;
  resolve: (accepted: boolean) => void;
};

const edgeProvider = new EdgeTtsProvider();

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rows, setRows] = useState<ProjectRow[]>([createBlankRow()]);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryAuthorized, setDirectoryAuthorized] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [localeFilter, setLocaleFilter] = useState("all");
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [studioConnecting, setStudioConnecting] = useState(false);
  const [studioModels, setStudioModels] = useState<StudioModelOption[]>([]);
  const [studioTabs, setStudioTabs] = useState<StudioTabOption[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState<number | undefined>(getSelectedStudioTabId);
  const [connectedStudioId, setConnectedStudioId] = useState<number | undefined>();
  const [organizerProgress, setOrganizerProgress] = useState("");
  const organizeStopRef = useRef(false);
  const busy = running || organizing || studioConnecting;
  const [paused, setPaused] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const controllerRef = useRef<TaskController | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewControllerRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const spreadsheetRef = useRef<ProjectSpreadsheetHandle | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([loadSettings(), getSavedDirectoryHandle()]).then(
      async ([storedSettings, storedDirectory]) => {
        if (!active) return;
        setSettings(storedSettings);
        setDirectory(storedDirectory);
        if (storedDirectory) {
          setDirectoryAuthorized(
            await ensureDirectoryPermission(storedDirectory, false),
          );
        }
        setSettingsReady(true);
        if (!storedSettings.voiceCache.length) void refreshVoices(storedSettings);
      },
    );
    void cleanupAllTempJobs().catch(() => undefined);
    return () => {
      active = false;
      stopPreview();
      controllerRef.current?.cancel();
      audioRef.current?.terminate();
    };
    // Initialization intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    const timeout = window.setTimeout(() => {
      void saveSettings(settings).catch(() => {
        showToast("error", "设置保存失败，请重新打开扩展后再试。");
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [settings, settingsReady]);

  useEffect(() => {
    if (!busy) return;
    const preventClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, [busy]);

  useEffect(() => {
    const availableIds = new Set(rows.map((row) => row.id));
    setSelectedRowIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  const locales = useMemo(
    () => Array.from(new Set(settings.voiceCache.map((voice) => voice.locale))).sort(),
    [settings.voiceCache],
  );

  const filteredVoices = useMemo(() => {
    const query = voiceSearch.trim().toLocaleLowerCase();
    return settings.voiceCache.filter((voice) => {
      const localeMatches = localeFilter === "all" || voice.locale === localeFilter;
      const queryMatches =
        !query ||
        `${voice.friendlyName} ${voice.shortName} ${voice.locale}`
          .toLocaleLowerCase()
          .includes(query);
      return localeMatches && queryMatches;
    });
  }, [localeFilter, settings.voiceCache, voiceSearch]);

  const selectedVoice = settings.voiceCache.find(
    (voice) => voice.shortName === settings.selectedVoice,
  );
  const validCount = rows.filter((row) => row.text.trim()).length;
  const completedCount = rows.filter((row) => row.status === "completed").length;
  const failedCount = rows.filter((row) => row.status === "failed").length;
  const activeRow = rows.find((row) => ["processing", "paused"].includes(row.status));
  const selectedCount = selectedRowIds.size;

  const updateSettings = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const updateRow = useCallback((id: string, patch: Partial<ProjectRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }, []);

  function replaceGridRows(nextRows: ProjectRow[]): void {
    spreadsheetRef.current?.replaceRows(nextRows);
    setRows(nextRows);
  }

  function focusGridRow(rowId: string, colKey: "raw" | "text" | "name" = "raw"): void {
    window.requestAnimationFrame(() => {
      spreadsheetRef.current?.focusRow(rowId, colKey);
    });
  }

  function addRowAtEnd(): void {
    const row = createBlankRow();
    replaceGridRows([...rows, row]);
    focusGridRow(row.id);
  }

  function insertRowAfterSelection(): void {
    const selectedIndex = rows.findIndex((row) => selectedRowIds.has(row.id));
    if (selectedIndex < 0) return;
    const row = createBlankRow();
    replaceGridRows([
      ...rows.slice(0, selectedIndex + 1),
      row,
      ...rows.slice(selectedIndex + 1),
    ]);
    spreadsheetRef.current?.clearSelection();
    setSelectedRowIds(new Set());
    focusGridRow(row.id);
  }

  function duplicateSelectedRow(): void {
    if (selectedRowIds.size !== 1) return;
    const sourceId = [...selectedRowIds][0];
    const index = rows.findIndex((row) => row.id === sourceId);
    const source = rows[index];
    if (!source) return;
    const row: ProjectRow = {
      ...createBlankRow(),
      rawText: source.rawText,
      text: source.text,
      name: source.name,
    };
    replaceGridRows([
      ...rows.slice(0, index + 1),
      row,
      ...rows.slice(index + 1),
    ]);
    spreadsheetRef.current?.clearSelection();
    setSelectedRowIds(new Set());
    focusGridRow(row.id, "name");
  }

  async function refreshVoices(baseSettings = settings): Promise<void> {
    setVoiceLoading(true);
    try {
      const voices = await edgeProvider.listVoices();
      const selected = voices.some(
        (voice) => voice.shortName === baseSettings.selectedVoice,
      )
        ? baseSettings.selectedVoice
        : (voices.find((voice) => voice.locale === "my-MM") ?? voices[0])?.shortName ??
          baseSettings.selectedVoice;
      setSettings((current) => ({
        ...current,
        selectedVoice: selected,
        voiceCache: voices,
        voiceCacheUpdatedAt: Date.now(),
      }));
      showToast("success", `已更新 ${voices.length} 个 Edge 音色。`);
    } catch (error) {
      const suffix = baseSettings.voiceCache.length ? "，已继续使用缓存列表" : "";
      showToast("error", `音色列表更新失败${suffix}：${errorMessage(error)}`);
    } finally {
      setVoiceLoading(false);
    }
  }

  async function chooseDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!("showDirectoryPicker" in window)) {
      showToast("error", "当前浏览器不支持目录授权，请使用最新版 Microsoft Edge。");
      return null;
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: "auto-audio-subtitles-output",
        mode: "readwrite",
        startIn: directory ?? undefined,
      });
      await saveDirectoryHandle(handle);
      setDirectory(handle);
      setDirectoryAuthorized(true);
      return handle;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      showToast("error", `无法选择目录：${errorMessage(error)}`);
      return null;
    }
  }

  async function resolveOutputDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!directory) return chooseDirectory();
    try {
      if (await ensureDirectoryPermission(directory, true)) {
        setDirectoryAuthorized(true);
        return directory;
      }
    } catch {
      // Fall through to choosing a new directory.
    }
    setDirectoryAuthorized(false);
    showToast("info", "原输出目录需要重新授权，请再次选择。");
    return chooseDirectory();
  }

  async function previewVoice(): Promise<void> {
    const text = settings.previewText.trim();
    if (!text) {
      showToast("error", "请先填写试听文本。");
      return;
    }
    stopPreview();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    setPreviewing(true);
    try {
      const blob = await edgeProvider.synthesize(text, {
        signal: controller.signal,
        voice: settings.selectedVoice,
        rate: formatRate(settings.rate),
        pitch: formatPitch(settings.pitch),
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewUrlRef.current = url;
      previewAudioRef.current = audio;
      audio.onended = stopPreview;
      audio.onerror = stopPreview;
      await audio.play();
    } catch (error) {
      if (controller.signal.aborted) return;
      stopPreview();
      showToast("error", `试听失败：${errorMessage(error)}`);
    }
  }

  function stopPreview(): void {
    previewControllerRef.current?.abort();
    previewControllerRef.current = null;
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewing(false);
  }

  async function runBatch(mode: "all" | "failed"): Promise<void> {
    if (busy) return;
    const currentRows = spreadsheetRef.current?.readRows() ?? rows;
    setRows(currentRows);
    const validated = validateSettings(settings);
    if (validated) {
      showToast("error", validated);
      return;
    }
    let jobs = buildJobs(currentRows, settings.startSequence);
    if (mode === "failed") {
      const failedIds = new Set(
        currentRows.filter((row) => row.status === "failed").map((row) => row.id),
      );
      jobs = jobs.filter((job) => failedIds.has(job.rowId));
    }
    if (!jobs.length) {
      showToast("error", mode === "failed" ? "没有失败项目可重试。" : "没有有效文案。");
      return;
    }

    const root = await resolveOutputDirectory();
    if (!root) return;
    const conflicts = await findExistingOutputFolders(root, jobs);
    if (conflicts.length) {
      const accepted = await askConfirmation({
        title: "覆盖已有输出？",
        confirmLabel: "覆盖并继续",
        destructive: true,
        message: (
          <>
            检测到 {conflicts.length} 个同名目录。扩展会删除其中原有的数字编号 MP3
            和 SRT，再写入新结果；其他文件不会被删除。
            <span className="dialog-paths">
              {conflicts.slice(0, 6).join("、")}
              {conflicts.length > 6 ? ` 等 ${conflicts.length} 项` : ""}
            </span>
          </>
        ),
      });
      if (!accepted) return;
    }

    setLogs([]);
    setRunning(true);
    setPaused(false);
    setCancelling(false);
    const selectedIds = new Set(jobs.map((job) => job.rowId));
    setRows((current) =>
      current.map((row) =>
        selectedIds.has(row.id)
          ? { ...row, status: "queued", progress: 0, detail: "等待处理", error: undefined }
          : row,
      ),
    );
    const controller = new TaskController();
    controllerRef.current = controller;
    const audio = audioRef.current ?? new AudioEngine((message) => appendLog(message));
    audioRef.current = audio;

    try {
      await cleanupAllTempJobs();
      const runner = new BatchRunner(edgeProvider, audio, root, settings, controller, {
        updateRow,
        log: appendLog,
      });
      const result = await runner.run(jobs);
      if (result.cancelled) {
        setRows((current) =>
          current.map((row) =>
            row.status === "queued"
              ? { ...row, status: "idle", progress: 0, detail: "未执行（任务已取消）" }
              : row,
          ),
        );
        showToast("info", `任务已取消，已完成 ${result.completed.length} 个项目。`);
      } else if (result.failed.length) {
        showToast(
          "error",
          `完成 ${result.completed.length} 个，失败 ${result.failed.length} 个，可点击“重试失败项”。`,
        );
      } else {
        showToast("success", `全部 ${result.completed.length} 个项目已生成完成。`);
      }
    } catch (error) {
      const message = errorMessage(error);
      setRows((current) =>
        current.map((row) =>
          selectedIds.has(row.id) && ["queued", "processing", "paused"].includes(row.status)
            ? { ...row, status: "failed", detail: "批处理无法启动", error: message }
            : row,
        ),
      );
      showToast("error", `批处理无法启动：${message}`);
      appendLog(message);
    } finally {
      controllerRef.current = null;
      setRunning(false);
      setPaused(false);
      setCancelling(false);
    }
  }

  async function refreshStudioTabs(): Promise<number | undefined> {
    const tabs = await listStudioTabs();
    setStudioTabs(tabs);
    const currentId = getSelectedStudioTabId();
    const id = tabs.some((tab) => tab.id === currentId) ? currentId : tabs.length === 1 ? tabs[0].id : undefined;
    selectStudioTab(id);
    setSelectedStudioId(id);
    if (id !== connectedStudioId) { setStudioModels([]); setConnectedStudioId(undefined); }
    return id;
  }

  async function openStudioPage(): Promise<void> {
    try {
      await openStudio();
      await refreshStudioTabs();
    } catch (error) { showToast("error", errorMessage(error)); }
  }

  async function connectStudio(): Promise<void> {
    if (busy) return;
    setStudioConnecting(true);
    try {
      const id = await refreshStudioTabs();
      if (id === undefined) throw new Error("请先打开 AI Studio；若有多个页面，请在标签页列表中明确选择一个。");
      const result = await discoverStudioModels(id);
      const models = result.models.filter((model) => !model.paid);
      setStudioModels(models);
      if (!models.length) throw new Error("没有找到免费文本模型，请检查 AI Studio 登录和模型列表。");
      const chosen = models.find((model) => model.id === settings.studioModelId)
        ?? models.find((model) => model.id === result.currentModelId) ?? models[0];
      updateSettings("studioModelId", chosen.id);
      setConnectedStudioId(id);
      showToast("success", `AI Studio #${id} 已连接，找到 ${models.length} 个免费文本模型。`);
    } catch (error) {
      setStudioModels([]);
      setConnectedStudioId(undefined);
      showToast("error", errorMessage(error));
    } finally {
      setStudioConnecting(false);
    }
  }

  async function organizeRows(selectedOnly: boolean): Promise<void> {
    if (busy) return;
    if (selectedStudioId === undefined || connectedStudioId !== selectedStudioId || !studioModels.some((model) => model.id === settings.studioModelId)) {
      showToast("error", "请先打开并登录 AI Studio，再连接免费模型。");
      return;
    }
    const interval = settings.studioIntervalSeconds;
    const timeout = settings.studioTimeoutSeconds;
    if (!Number.isFinite(interval) || interval < 0 || interval > 300 ||
        !Number.isFinite(timeout) || timeout < 30 || timeout > 600) {
      showToast("error", "请求间隔须为 0–300 秒，回复超时须为 30–600 秒。");
      return;
    }
    let current = spreadsheetRef.current?.readRows() ?? rows;
    const targets = current.filter((row) => row.rawText?.trim() && (!selectedOnly || selectedRowIds.has(row.id)));
    if (!targets.length) { showToast("info", "请先在原始缅文列填入文案。"); return; }
    organizeStopRef.current = false;
    const batchTabId = selectedStudioId;
    setOrganizing(true);
    let completed = 0;
    const apply = (id: string, patch: Partial<ProjectRow>) => {
      current = current.map((row) => row.id === id ? { ...row, ...patch } : row);
      replaceGridRows(current);
    };
    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (organizeStopRef.current) break;
        if (index > 0) {
          const deadline = Date.now() + interval * 1000;
          while (Date.now() < deadline && !organizeStopRef.current) {
            setOrganizerProgress(`请求间隔 · ${Math.ceil((deadline - Date.now()) / 1000)} 秒`);
            await new Promise((resolve) => window.setTimeout(resolve, 200));
          }
        }
        if (organizeStopRef.current) break;
        const row = targets[index];
        setOrganizerProgress(`正在整理 ${index + 1}/${targets.length}`);
        apply(row.id, { organizeDetail: "AI 整理中…" });
        try {
          const result = cleanOrganizerResult(await organizeInStudio(
            buildOrganizerPrompt(row.rawText!), settings.studioModelId, timeout, batchTabId,
          ));
          // 停止请求后丢弃尚未完成的结果，保留原文及此前的结果。
          if (organizeStopRef.current) { apply(row.id, { organizeDetail: "整理已停止" }); break; }
          apply(row.id, { text: result, status: "idle", progress: 0, detail: "", error: undefined, organizeDetail: "整理完成 · 可生成音频" });
          completed += 1;
        } catch (error) {
          const message = errorMessage(error);
          apply(row.id, { organizeDetail: `整理失败 · ${message}` });
          appendLog(`第 ${index + 1} 项整理失败：${message}`);
          // 网页失联、限流、超时等需处理后再发起，避免持续提交。
          showToast("error", `整理已停止：${message}（已完成 ${completed} 项）`);
          return;
        }
      }
      showToast("info", `${organizeStopRef.current ? "整理已停止" : "整理完成"}，已写入 ${completed} 项。`);
    } finally {
      setOrganizing(false);
      setOrganizerProgress("");
    }
  }

  function pauseBatch(): void {
    controllerRef.current?.pause();
    setPaused(true);
    setRows((current) =>
      current.map((row) =>
        row.status === "processing"
          ? { ...row, status: "paused", detail: "当前操作完成后暂停" }
          : row,
      ),
    );
  }

  function resumeBatch(): void {
    controllerRef.current?.resume();
    setPaused(false);
    setRows((current) =>
      current.map((row) =>
        row.status === "paused"
          ? { ...row, status: "processing", detail: "继续处理中…" }
          : row,
      ),
    );
  }

  function cancelBatch(): void {
    controllerRef.current?.cancel();
    setCancelling(true);
    setPaused(false);
    showToast("info", "正在安全取消，当前操作结束后停止…");
  }

  async function clearRows(): Promise<void> {
    if (
      !(await askConfirmation({
        title: "清空全部文案？",
        message: "文案不会被缓存，清空后无法恢复。用户设置和输出目录不会受影响。",
        confirmLabel: "确认清空",
        destructive: true,
      }))
    )
      return;
    replaceGridRows([createBlankRow()]);
    spreadsheetRef.current?.clearSelection();
    setSelectedRowIds(new Set());
  }

  async function deleteSelectedRows(): Promise<void> {
    if (!selectedRowIds.size) return;
    if (
      !(await askConfirmation({
        title: `删除所选的 ${selectedRowIds.size} 个项目？`,
        message: "所选项目的文案和项目名称会从当前页面移除，此操作无法撤销。",
        confirmLabel: "删除所选",
        destructive: true,
      }))
    )
      return;
    const selected = new Set(selectedRowIds);
    const remaining = rows.filter((row) => !selected.has(row.id));
    replaceGridRows(remaining.length ? remaining : [createBlankRow()]);
    spreadsheetRef.current?.clearSelection();
    setSelectedRowIds(new Set());
  }

  function askConfirmation(input: Omit<Confirmation, "resolve">): Promise<boolean> {
    return new Promise((resolve) => setConfirmation({ ...input, resolve }));
  }

  function answerConfirmation(accepted: boolean): void {
    confirmation?.resolve(accepted);
    setConfirmation(null);
  }

  function appendLog(message: string): void {
    setLogs((current) => [...current.slice(-79), message]);
  }

  function showToast(kind: Toast["kind"], message: string): void {
    const next = { id: Date.now(), kind, message };
    setToast(next);
    window.setTimeout(
      () => setToast((current) => (current?.id === next.id ? null : current)),
      5200,
    );
  }

  if (!settingsReady) {
    return (
      <main className="loading-screen">
        <div className="brand-mark"><WandSparkles size={23} /></div>
        <LoaderCircle className="spin" size={20} />
        <p>正在打开工作台…</p>
      </main>
    );
  }

  const workStatus = organizing
    ? organizerProgress || "正在整理文案"
    : studioConnecting
      ? "正在连接 AI Studio"
      : cancelling
    ? "正在安全取消"
    : paused
      ? "任务已暂停"
      : running
        ? "正在生成"
        : failedCount
          ? "存在失败项目"
          : "就绪";

  return (
    <main className={`workspace-shell ${settingsOpen ? "settings-open" : ""}`}>
      <header className="workspace-header">
        <div className="workspace-brand">
          <span className="brand-mark"><WandSparkles size={20} /></span>
          <div><h1>自动音频字幕</h1><p>缅文整理 · Edge TTS 工作台</p></div>
        </div>

        <div className="context-strip">
          <button className="context-item" onClick={() => setSettingsOpen(true)} title="打开声音设置">
            <Volume2 size={16} />
            <span><small>当前音色</small><strong>{(selectedVoice?.friendlyName ?? settings.selectedVoice) || "未选择"}</strong></span>
          </button>
          <button className="context-item" onClick={() => void chooseDirectory()} disabled={busy} title="选择输出目录">
            <FolderOpen size={16} />
            <span><small>输出目录</small><strong>{directory?.name ?? "尚未选择"}</strong></span>
            <i className={`permission-dot ${directory && directoryAuthorized ? "ready" : ""}`} />
          </button>
          <button className="context-item compact" onClick={() => setSettingsOpen(true)} title="打开分段设置">
            <Clock3 size={16} />
            <span><small>最大分段</small><strong>{settings.maxSegmentSeconds} 秒</strong></span>
          </button>
          <button className="context-item compact" onClick={() => setSettingsOpen(true)} title="打开起始序号设置">
            <ListOrdered size={16} />
            <span><small>起始序号</small><strong>{settings.startSequence}</strong></span>
          </button>
        </div>

        <div className="header-actions">
          <button className={`toolbar-button ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen((open) => !open)}>
            <Settings2 size={17} /> 设置
          </button>
          <button className="generate-button" onClick={() => void runBatch("all")} disabled={busy || validCount === 0}>
            {running ? <LoaderCircle className="spin" size={17} /> : <Play size={17} fill="currentColor" />}
            {running ? "生成中" : "生成音频"}
          </button>
        </div>
      </header>

      <div className="workspace-content">
        <section className="grid-workspace" aria-label="项目工作区">
          <div className="grid-commandbar">
            <div className="grid-title">
              <ListMusic size={18} />
              <div><h2>项目</h2><p>{validCount} 个有效项目 · 每个单元格内换行对应一条字幕</p></div>
            </div>
            <div className="grid-actions">
              {selectedCount > 0 && <span className="selection-summary">已选 {selectedCount}</span>}
              <button onClick={addRowAtEnd} disabled={busy}><Plus size={15} /> 添加</button>
              <button onClick={insertRowAfterSelection} disabled={busy || selectedCount !== 1}><Plus size={15} /> 下方插入</button>
              <button onClick={duplicateSelectedRow} disabled={busy || selectedCount !== 1}><Copy size={15} /> 复制项目</button>
              <span className="toolbar-separator" />
              <button className="danger" onClick={() => void deleteSelectedRows()} disabled={busy || selectedCount === 0}><Trash2 size={15} /> 删除</button>
              <button onClick={() => void clearRows()} disabled={busy}><X size={15} /> 清空</button>
            </div>
          </div>

          <div className="organizer-commandbar">
            <span className="organizer-label"><Sparkles size={16} /> 批量整理文案</span>
            <button className="toolbar-button" disabled={busy} onClick={() => void openStudioPage()}>打开 AI Studio / 登录</button>
            <button className="toolbar-button" disabled={busy} onClick={() => void refreshStudioTabs().catch((error) => showToast("error", errorMessage(error)))}>刷新标签页</button>
            <select aria-label="AI Studio 标签页" value={selectedStudioId ?? ""} disabled={busy} onChange={(event) => {
              const id = event.target.value ? Number(event.target.value) : undefined;
              selectStudioTab(id); setSelectedStudioId(id); setStudioModels([]); setConnectedStudioId(undefined);
            }}>
              <option value="">请选择 AI Studio 标签页</option>
              {studioTabs.map((tab) => <option key={tab.id} value={tab.id}>#{tab.id} · {tab.title}</option>)}
            </select>
            <button className="toolbar-button" disabled={busy} onClick={() => void connectStudio()}>{studioConnecting ? "连接中…" : "连接 / 刷新模型"}</button>
            <select aria-label="AI Studio 免费文本模型" value={settings.studioModelId} disabled={busy || !studioModels.length} onChange={(event) => updateSettings("studioModelId", event.target.value)}>
              {!studioModels.length && <option value={settings.studioModelId}>请先连接免费模型</option>}
              {studioModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
            <button className="primary-button" disabled={busy || !studioModels.length} onClick={() => void organizeRows(false)}>整理全部</button>
            <button className="toolbar-button" disabled={busy || !studioModels.length || !selectedCount} onClick={() => void organizeRows(true)}>整理所选</button>
            {organizing && <button className="toolbar-button" onClick={() => { organizeStopRef.current = true; setOrganizerProgress("正在停止 · 等待当前 AI 回复结束"); }}>停止整理</button>}
            <span className="organizer-hint">A 原文 → B 整理结果 → 生成音频</span>
          </div>

          <ProjectSpreadsheet
            ref={spreadsheetRef}
            rows={rows}
            running={busy}
            onRowsChange={setRows}
            onSelectionChange={setSelectedRowIds}
          />
        </section>

        {settingsOpen && (
          <aside className="settings-drawer" aria-label="生成设置">
            <div className="drawer-header">
              <div><h2>生成设置</h2><p><Save size={12} /> 修改后自动保存</p></div>
              <button onClick={() => setSettingsOpen(false)} aria-label="关闭设置"><X size={17} /></button>
            </div>
            <div className="drawer-scroll">
              <section className="settings-section">
                <SectionHeading icon={<Sparkles />} title="AI 文案整理" subtitle="免费文本模型 · 每条新建临时会话" />
                <label className="field"><span>请求间隔（秒）</span><input type="number" min={0} max={300} value={settings.studioIntervalSeconds} disabled={busy} onChange={(event) => updateSettings("studioIntervalSeconds", Number(event.target.value))} /></label>
                <label className="field"><span>回复超时（秒）</span><input type="number" min={30} max={600} value={settings.studioTimeoutSeconds} disabled={busy} onChange={(event) => updateSettings("studioTimeoutSeconds", Number(event.target.value))} /></label>
                <p className="section-note">每行约 20–70 字符，优先按标点和语义断行，去空行、末尾标签和表情。整理全部/所选会替换对应的 B 列，请检查结果后生成音频。停止会等待当前回复结束。</p>
              </section>
              <section className="settings-section">
                <SectionHeading icon={<Volume2 />} title="声音" subtitle="统一应用到全部项目" />
                <div className="drawer-field-row voice-search-row">
                  <label className="field grow">
                    <span>搜索音色</span>
                    <input value={voiceSearch} onChange={(event) => setVoiceSearch(event.target.value)} placeholder="名称或 ShortName" disabled={busy} />
                  </label>
                  <button className="square-button field-button" onClick={() => void refreshVoices()} disabled={voiceLoading || busy} title="刷新音色">
                    <RefreshCw className={voiceLoading ? "spin" : ""} size={16} />
                  </button>
                </div>
                <label className="field">
                  <span>地区</span>
                  <div className="select-wrap">
                    <select value={localeFilter} onChange={(event) => setLocaleFilter(event.target.value)} disabled={busy}>
                      <option value="all">全部地区</option>
                      {locales.map((locale) => <option key={locale}>{locale}</option>)}
                    </select>
                    <ChevronDown size={15} />
                  </div>
                </label>
                <label className="field">
                  <span>当前音色</span>
                  <div className="select-wrap">
                    <select value={settings.selectedVoice} onChange={(event) => updateSettings("selectedVoice", event.target.value)} disabled={busy || !settings.voiceCache.length}>
                      {selectedVoice && !filteredVoices.some((voice) => voice.shortName === selectedVoice.shortName) && (
                        <option value={selectedVoice.shortName}>{voiceLabel(selectedVoice)}</option>
                      )}
                      {filteredVoices.map((voice) => <option key={voice.shortName} value={voice.shortName}>{voiceLabel(voice)}</option>)}
                    </select>
                    <ChevronDown size={15} />
                  </div>
                </label>
                <div className="range-stack">
                  <RangeField label="语速" value={settings.rate} min={-50} max={100} step={5} suffix="%" disabled={busy} onChange={(value) => updateSettings("rate", value)} />
                  <RangeField label="音调" value={settings.pitch} min={-50} max={50} step={5} suffix="Hz" disabled={busy} onChange={(value) => updateSettings("pitch", value)} />
                </div>
                <div className="preview-control">
                  <label className="field grow">
                    <span>试听文本</span>
                    <input value={settings.previewText} onChange={(event) => updateSettings("previewText", event.target.value)} disabled={busy} />
                  </label>
                  <button className={`square-button field-button ${previewing ? "stop" : ""}`} onClick={() => previewing ? stopPreview() : void previewVoice()} disabled={busy} title={previewing ? "停止试听" : "试听当前音色"}>
                    {previewing ? <Square size={14} fill="currentColor" /> : <Headphones size={16} />}
                  </button>
                </div>
                <p className="section-note">{settings.voiceCache.length ? `已缓存 ${settings.voiceCache.length} 个在线音色` : "尚未缓存音色，请刷新列表"}</p>
              </section>

              <section className="settings-section">
                <SectionHeading icon={<FolderOpen />} title="输出" subtitle="直接写入授权目录" />
                <button className={`directory-control ${directory ? "selected" : ""}`} onClick={() => void chooseDirectory()} disabled={busy}>
                  <FolderOpen size={18} />
                  <span><strong>{directory?.name ?? "选择输出目录"}</strong><small>{directory ? (directoryAuthorized ? "已授权读写" : "生成时需要重新授权") : "不会保存文案或中间文件"}</small></span>
                  <em>{directory ? "更换" : "选择"}</em>
                </button>
                <div className="number-grid">
                  <label className="field">
                    <span>最大分段时长</span>
                    <div className="number-suffix"><input type="number" min="1" step="1" value={settings.maxSegmentSeconds} onChange={(event) => updateSettings("maxSegmentSeconds", Number(event.target.value))} disabled={busy} /><span>秒</span></div>
                  </label>
                  <label className="field">
                    <span>起始序号</span>
                    <input type="number" min="1" step="1" value={settings.startSequence} onChange={(event) => updateSettings("startSequence", Number(event.target.value))} disabled={busy} />
                  </label>
                </div>
              </section>

              <section className="settings-section compact-section">
                <SectionHeading icon={<Clock3 />} title="处理规则" subtitle="当前版本固定规则" />
                <dl className="rules-list">
                  <div><dt>静音阈值</dt><dd>-50 dB</dd></div>
                  <div><dt>开头保留</dt><dd>0.1 秒</dd></div>
                  <div><dt>句末停顿</dt><dd>0.5 秒</dd></div>
                  <div><dt>其他停顿</dt><dd>0.2 秒</dd></div>
                </dl>
              </section>
            </div>
          </aside>
        )}
      </div>

      <footer className="workspace-statusbar">
        <div className="status-primary">
          <i className={`status-indicator ${busy ? "running" : failedCount ? "failed" : ""}`} />
          <strong>{workStatus}</strong>
          <span>{activeRow?.detail ?? `${validCount} 个有效 · ${completedCount} 个完成${failedCount ? ` · ${failedCount} 个失败` : ""}`}</span>
        </div>
        <div className="status-actions">
          {logs.length > 0 && (
            <details className="status-logs">
              <summary>日志 {logs.length}</summary>
              <pre>{logs.join("\n")}</pre>
            </details>
          )}
          {failedCount > 0 && !busy && <button onClick={() => void runBatch("failed")}><RotateCcw size={14} /> 重试失败项</button>}
          {running && !paused && <button onClick={pauseBatch} disabled={cancelling}><Pause size={14} /> 暂停</button>}
          {running && paused && <button onClick={resumeBatch} disabled={cancelling}><CirclePlay size={14} /> 继续</button>}
          {running && <button className="danger" onClick={cancelBatch} disabled={cancelling}><Square size={12} fill="currentColor" /> {cancelling ? "取消中" : "取消"}</button>}
        </div>
      </footer>

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.kind === "success" ? <Check size={17} /> : toast.kind === "error" ? <AlertCircle size={17} /> : <Sparkles size={17} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      {confirmation && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && answerConfirmation(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div className={`dialog-icon ${confirmation.destructive ? "warning" : ""}`}><AlertCircle size={22} /></div>
            <h3 id="dialog-title">{confirmation.title}</h3>
            <div className="dialog-message">{confirmation.message}</div>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => answerConfirmation(false)}>取消</button>
              <button className={confirmation.destructive ? "danger-button" : "primary-button"} onClick={() => answerConfirmation(true)}>{confirmation.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function SectionHeading({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return <div className="section-heading"><span>{icon}</span><div><h3>{title}</h3><p>{subtitle}</p></div></div>;
}

function RangeField({ label, value, min, max, step, suffix, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; disabled: boolean; onChange(value: number): void }) {
  return (
    <label className="range-field">
      <span><b>{label}</b><em>{value >= 0 ? "+" : ""}{value}{suffix}</em></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} />
      <small><i>{min}{suffix}</i><i>{max > 0 ? "+" : ""}{max}{suffix}</i></small>
    </label>
  );
}

function createBlankRow(): ProjectRow {
  return {
    id: crypto.randomUUID(),
    rawText: "",
    text: "",
    name: "",
    status: "idle",
    progress: 0,
    detail: "",
  };
}

function voiceLabel(voice: VoiceInfo): string {
  const gender = voice.gender === "Female" ? "女" : "男";
  return `${voice.locale} · ${voice.friendlyName} · ${gender}`;
}

function validateSettings(settings: AppSettings): string | null {
  if (!settings.selectedVoice) return "请先选择一个音色。";
  if (!Number.isFinite(settings.maxSegmentSeconds) || settings.maxSegmentSeconds < 1) return "最大分段时长必须大于等于 1 秒。";
  if (!Number.isInteger(settings.startSequence) || settings.startSequence < 1) return "起始序号必须是大于等于 1 的整数。";
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
