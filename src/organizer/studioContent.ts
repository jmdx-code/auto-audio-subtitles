import type { StudioModelOption, StudioModelsResult, StudioPromptResult, StudioRequest } from "./types";
type ThinkingLevel = string;
type StudioStatus = { ready: boolean; modelId: string; thinkingLevel: string; googleSearchEnabled: boolean; message: string };
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
  read: () => T | null | undefined | false,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = read();
    if (value) return value;
    await delay(100);
  }
  throw new Error(message);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function getCurrentModelId() {
  return normalizeText(
    document.querySelector<HTMLSpanElement>(
      "button.model-selector-card [data-test-id='model-name']",
    )?.textContent,
  );
}

function getCurrentModelLabel() {
  return normalizeText(
    document.querySelector<HTMLElement>("button.model-selector-card .title")
      ?.textContent,
  );
}

async function ensureRunSettingsOpen() {
  const existing = document.querySelector<HTMLButtonElement>(
    "button.model-selector-card",
  );
  if (existing) return existing;

  const toggle = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => {
    const ariaLabel = normalizeText(button.getAttribute("aria-label"));
    return (
      /toggle run settings|运行设置|运行配置/i.test(ariaLabel) ||
      normalizeText(button.textContent) === "tune"
    );
  });
  if (!toggle) throw new Error("找不到 AI Studio 运行设置按钮");
  toggle.click();
  return waitFor(
    () =>
      document.querySelector<HTMLButtonElement>("button.model-selector-card"),
    10_000,
    "AI Studio 运行设置面板没有打开",
  );
}

function getOpenModelDialog() {
  return document.querySelector<HTMLElement>(
    ".cdk-overlay-container [data-test-id='model-carousel-in-selector'], mat-dialog-container ms-model-carousel",
  );
}

async function openModelDialog() {
  const existing = getOpenModelDialog();
  if (existing) return existing;
  const selector = await ensureRunSettingsOpen();
  selector.click();
  return waitFor(getOpenModelDialog, 10_000, "AI Studio 模型列表没有打开");
}

function isCompatibleTextModel(modelId: string) {
  return (
    /^gemini-/i.test(modelId) &&
    !/(?:^|-)(?:image|live|audio|tts|omni|transcribe|robotics)(?:-|$)/i.test(modelId)
  );
}

function readModelOptions(dialog: HTMLElement) {
  const options = new Map<string, StudioModelOption>();
  for (const row of dialog.querySelectorAll<HTMLElement>(
    "ms-model-carousel-row",
  )) {
    const id = normalizeText(
      row.querySelector<HTMLElement>(".model-subtitle")?.textContent,
    );
    if (!id || !isCompatibleTextModel(id)) continue;
    const label = normalizeText(
      row.querySelector<HTMLElement>(".model-title-text")?.textContent,
    );
    options.set(id, {
      id,
      label: label || id,
      paid: Boolean(row.querySelector(".badge.paid")),
    });
  }

  // 兼容 AI Studio 旧版模型选择器。
  for (const name of dialog.querySelectorAll<HTMLElement>(
    "[data-test-id='model-name']",
  )) {
    const id = normalizeText(name.textContent);
    if (!id || !isCompatibleTextModel(id)) continue;
    const button = name.closest<HTMLButtonElement>("button");
    const title = normalizeText(
      button?.querySelector<HTMLElement>(".title")?.textContent,
    );
    if (!options.has(id)) {
      options.set(id, { id, label: title || id, paid: Boolean(button?.querySelector(".badge.paid")) });
    }
  }
  return Array.from(options.values());
}

function closeModelDialog(dialog: HTMLElement) {
  const container =
    dialog.closest<HTMLElement>("mat-dialog-container") ?? dialog;
  const closeButton = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => {
    const ariaLabel = normalizeText(button.getAttribute("aria-label"));
    return (
      /close|关闭/i.test(ariaLabel) &&
      !button.classList.contains("search-bar-close-button")
    );
  });
  closeButton?.click();
}

async function showGeminiCategory(dialog: HTMLElement) {
  const category = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>(
      "button[data-test-category-button]",
    ),
  ).find((button) => normalizeText(button.textContent) === "Gemini");
  if (!category || category.getAttribute("aria-selected") === "true") return;
  category.click();
  await waitFor(
    () =>
      category.getAttribute("aria-selected") === "true" &&
      readModelOptions(dialog).length > 0,
    10_000,
    "AI Studio Gemini 模型分类没有加载完成",
  );
}

async function discoverStudioModels(): Promise<StudioModelsResult> {
  const dialog = await openModelDialog();
  try {
    await showGeminiCategory(dialog);
    const models = await waitFor(
      () => {
        const found = readModelOptions(dialog);
        return found.length > 0 ? found : null;
      },
      10_000,
      "AI Studio 模型列表尚未加载",
    );
    const currentModelId = getCurrentModelId();
    return { currentModelId, models };
  } finally {
    closeModelDialog(dialog);
  }
}

function findModelButton(modelId: string) {
  const names = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".model-subtitle, [data-test-id='model-name']",
    ),
  );
  const name = names.find(
    (item) => normalizeText(item.textContent) === modelId,
  );
  return (
    name
      ?.closest<HTMLElement>("ms-model-carousel-row")
      ?.querySelector<HTMLButtonElement>("button.content-button") ??
    name?.closest<HTMLButtonElement>("button")
  );
}

async function ensureModel(modelId: string) {
  const dialog = await openModelDialog();
  await showGeminiCategory(dialog);
  const option = readModelOptions(dialog).find((model) => model.id === modelId);
  if (!option || option.paid) { closeModelDialog(dialog); throw new Error("所选模型无法确认为免费文本模型，请重新连接并选择。"); }
  if (getCurrentModelId() === modelId) { closeModelDialog(dialog); return; }

  let modelButton = findModelButton(modelId);
  if (!modelButton) {
    const searchInput = dialog.querySelector<HTMLInputElement>("input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (searchInput && setter) {
      setter.call(searchInput, modelId);
      searchInput.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: modelId }),
      );
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    modelButton = await waitFor(
      () => findModelButton(modelId),
      10_000,
      `AI Studio 模型列表中没有找到 ${modelId}`,
    );
  }

  modelButton.click();
  await waitFor(
    () => getCurrentModelId() === modelId,
    10_000,
    `切换到 ${modelId} 失败`,
  );
}

async function disableGoogleSearch() {
  const searchSwitch = document.querySelector<HTMLButtonElement>("button[role='switch'][aria-label='Grounding with Google Search']");
  if (!searchSwitch) return;

  if (searchSwitch.getAttribute("aria-checked") === "true") {
    searchSwitch.click();
    await waitFor(
      () => searchSwitch.getAttribute("aria-checked") === "false",
      5_000,
      "关闭 Google Search 失败",
    );
  }
}

function getCurrentThinkingLevel() {
  return normalizeText(
    document.querySelector<HTMLElement>(
      "[role='combobox'][aria-label='Thinking Level']",
    )?.textContent,
  );
}

async function prepareStudio(
  modelId: string,
  thinkingLevel: ThinkingLevel,
): Promise<StudioStatus> {
  if (location.origin !== "https://aistudio.google.com") {
    throw new Error("当前标签页不是 Google AI Studio");
  }

  await waitFor(
    () =>
      document.querySelector<HTMLTextAreaElement>(
        "textarea[aria-label='Enter a prompt']",
      ),
    15_000,
    "AI Studio 提示词输入框尚未就绪",
  );
  await ensureModel(modelId);
  // 不同模型的思考设置不同，沿用网页默认值。
  await disableGoogleSearch();

  return {
    ready: true,
    modelId: getCurrentModelId(),
    thinkingLevel: getCurrentThinkingLevel(),
    googleSearchEnabled:
      document
        .querySelector(
          "[role='switch'][aria-label='Grounding with Google Search']",
        )
        ?.getAttribute("aria-checked") === "true",
    message: "AI Studio 已就绪",
  };
}

function fillPrompt(textarea: HTMLTextAreaElement, prompt: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("无法写入 AI Studio 提示词输入框");
  setter.call(textarea, prompt);
  textarea.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: prompt }),
  );
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function getModelTurns() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "ms-chat-turn .chat-turn-container.model",
    ),
  );
}

function findGenerationError(turn: HTMLElement) {
  return normalizeText(
    turn.querySelector<HTMLElement>(".model-error")?.innerText,
  );
}

function readAnswerText(turn: HTMLElement): string {
  // AI Studio 的思考过程与正文可能位于不同的 ms-chat-turn。
  // turn-content 还包含作者、时间和 Thoughts 控件，不能当作正文返回。
  return Array.from(turn.querySelectorAll<HTMLElement>("ms-text-chunk"))
    .filter((chunk) => !chunk.closest("ms-thought-chunk"))
    .map((chunk) => chunk.innerText.replace(/\r\n?/g, "\n").trim())
    .filter(Boolean).join("\n");
}

function getStopButton(): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.getClientRects().length > 0 &&
      /^(?:stop|stop generating|stop generation|停止|停止生成)$/i.test(
        normalizeText(button.getAttribute("aria-label") || button.textContent),
      ),
  );
}

async function startTemporaryChat(): Promise<void> {
  const newChat = await waitFor(
    () => document.querySelector<HTMLButtonElement>("button[aria-label='New chat']"),
    10_000,
    "找不到 AI Studio 新建会话按钮，已停止以避免沿用旧上下文。",
  );
  const hasTurns = document.querySelectorAll("ms-chat-turn").length > 0;
  if (!newChat.disabled && newChat.getAttribute("aria-disabled") !== "true") {
    newChat.click();
  } else if (hasTurns) {
    throw new Error("AI Studio 新建会话按钮不可用，已停止以避免沿用旧上下文。");
  }
  let discarded = false;
  await waitFor(() => {
    // 临时会话有内容时，新建会话会要求丢弃本次临时记录。
    // 只处理“新建会话”这个明确的提示，不点击其他对话框中的按钮。
    if (!discarded) {
      const dialog = Array.from(document.querySelectorAll<HTMLElement>("mat-dialog-container, [id^='mat-mdc-dialog-']"))
        .find((node) => /Create a new chat|创建新对话|新建会话/i.test(node.textContent ?? ""));
      const discard = dialog && Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => /^(Discard and continue|舍弃并继续|放弃并继续)$/i.test(normalizeText(button.textContent)));
      if (discard && !discard.disabled && discard.getAttribute("aria-disabled") !== "true") {
        discarded = true;
        discard.click();
      }
    }
    const input = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Enter a prompt']");
    return document.querySelectorAll("ms-chat-turn").length === 0 && input && !input.value.trim() ? input : null;
  }, 15_000, "AI Studio 旧会话未清空，已停止以避免上下文串联。");

  const isTemporary = () => Boolean(document.querySelector(".incognito-icon, .incognito-container"));
  if (!isTemporary()) {
    const menu = await waitFor(
      () => document.querySelector<HTMLButtonElement>("button[aria-label='View more actions']"),
      10_000,
      "找不到 AI Studio 会话菜单，无法开启临时会话。",
    );
    menu.click();
    const toggle = await waitFor(
      () => document.querySelector<HTMLButtonElement>("button[data-test-incognito-toggle]"),
      5_000,
      "找不到 AI Studio 临时会话开关，已停止。",
    );
    if (toggle.disabled || toggle.getAttribute("aria-disabled") === "true") {
      throw new Error("AI Studio 临时会话开关不可用，已停止。");
    }
    toggle.click();
    await waitFor(isTemporary, 5_000, "AI Studio 临时会话未开启，已停止。");
  }
}

async function waitForModelResult(
  previousTurnCount: number,
  timeoutMs: number,
): Promise<Omit<StudioPromptResult, "elapsedMs">> {
  await waitFor(
    () => {
      const turns = getModelTurns();
      return turns.length > previousTurnCount;
    },
    Math.min(timeoutMs, 30_000),
    "AI Studio 没有创建模型回复回合",
  );

  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    const turns = getModelTurns();
    const newTurns = turns.slice(previousTurnCount);
    if (!newTurns.length) {
      await delay(250);
      continue;
    }

    const error = newTurns.map(findGenerationError).find(Boolean);
    if (error) {
      console.warn("[AI Studio 文案工作台] 模型回合返回错误");
      return { ok: false, text: "", error };
    }

    const answerTurns = newTurns.filter((turn) => readAnswerText(turn));
    const text = answerTurns.map(readAnswerText).join("\n");
    if (text !== lastText) {
      lastText = text;
      stableSince = Date.now();
    }

    const isRendered = answerTurns.length > 0 && answerTurns.every((turn) => turn.classList.contains("render"));
    const stopButton = getStopButton();

    if (
      lastText &&
      isRendered &&
      !stopButton &&
      Date.now() - stableSince >= 1_500
    ) {
      console.info("[AI Studio 文案工作台] 已识别模型回复", {
        characters: lastText.length,
      });
      return { ok: true, text: lastText, error: "" };
    }

    await delay(250);
  }

  getStopButton()?.click();
  return {
    ok: false,
    text: lastText,
    error: `等待 AI Studio 回复超时（${Math.round(timeoutMs / 1000)} 秒）`,
  };
}

async function runStudioPrompt(
  prompt: string,
  modelId: string,
  thinkingLevel: ThinkingLevel,
  timeoutMs: number,
): Promise<StudioPromptResult> {
  const startedAt = Date.now();
  if (getStopButton()) throw new Error("AI Studio 正在生成，请等待当前回复完成后再整理。");
  await startTemporaryChat();
  await prepareStudio(modelId, thinkingLevel);

  const textarea = await waitFor(
    () =>
      document.querySelector<HTMLTextAreaElement>(
        "textarea[aria-label='Enter a prompt']",
      ),
    10_000,
    "找不到 AI Studio 提示词输入框",
  );
  const previousTurnCount = getModelTurns().length;
  fillPrompt(textarea, prompt);

  const runButton = await waitFor(
    () => {
      const button = document.querySelector<HTMLButtonElement>(
        "button.ctrl-enter-submits",
      );
      return button && !button.disabled && button.getAttribute("aria-disabled") !== "true" ? button : null;
    },
    10_000,
    "AI Studio 运行按钮没有启用",
  );
  runButton.click();

  const result = await waitForModelResult(previousTurnCount, timeoutMs);
  return { ...result, elapsedMs: Date.now() - startedAt };
}


const studioGlobal = globalThis as typeof globalThis & { __audioSubtitlesStudio?: boolean };
if (!studioGlobal.__audioSubtitlesStudio) {
  studioGlobal.__audioSubtitlesStudio = true;
  let busy = false;
  chrome.runtime.onMessage.addListener((message: StudioRequest & { channel?: string }, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id
      || sender.url !== chrome.runtime.getURL("workbench.html")
      || location.origin !== "https://aistudio.google.com"
      || message?.channel !== "audio-subtitles-studio") return;
    if (message.action === "ping") { sendResponse({ ok: true }); return; }
    if (message.action !== "models" && (message.action !== "run"
      || typeof message.prompt !== "string" || !message.prompt.trim()
      || typeof message.modelId !== "string" || !message.modelId.trim()
      || typeof message.timeoutMs !== "number" || !Number.isFinite(message.timeoutMs))) {
      sendResponse({ ok: false, error: "无效请求" });
      return;
    }
    if (busy) { sendResponse({ ok: false, error: "AI Studio 正在执行任务，请稍后再试。" }); return; }
    busy = true;
    const task = message.action === "models" ? discoverStudioModels()
      : message.action === "run" ? runStudioPrompt(message.prompt, message.modelId, "", Math.min(600_000, Math.max(30_000, message.timeoutMs)))
      : Promise.reject(new Error("未知请求"));
    void task.then((data) => sendResponse({ ok: true, data }), (error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    ).finally(() => { busy = false; });
    return true;
  });
}
