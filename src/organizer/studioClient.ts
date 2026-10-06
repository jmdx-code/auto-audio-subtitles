import type { StudioRequest, StudioModelsResult, StudioPromptResult } from "./types";

const studioUrl = "https://aistudio.google.com/prompts/new_chat";
const selectionKey = "audio-subtitles-studio-tab";
let tabId: number | undefined;
try {
  const saved = sessionStorage.getItem(selectionKey);
  if (saved && Number.isInteger(Number(saved))) tabId = Number(saved);
} catch { /* Session storage is optional. */ }
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export type StudioTabOption = { id: number; title: string; url: string; windowId: number };

function isStudioChat(url?: string): boolean {
  try {
    const parsed = new URL(url ?? "");
    return parsed.origin === "https://aistudio.google.com" && /^\/(?:u\/\d+\/)?prompts(?:\/|$)/.test(parsed.pathname);
  } catch { return false; }
}

export function getSelectedStudioTabId(): number | undefined { return tabId; }

export function selectStudioTab(id: number | undefined): void {
  tabId = id;
  try {
    if (id === undefined) sessionStorage.removeItem(selectionKey);
    else sessionStorage.setItem(selectionKey, String(id));
  } catch { /* Session storage is optional. */ }
}

export async function listStudioTabs(): Promise<StudioTabOption[]> {
  if (!chrome.tabs?.query) throw new Error("请在安装后的扩展工作台中使用 AI Studio。");
  // url 过滤会遗漏刚创建、仅有 pendingUrl 的页面，先枚举再精确过滤。
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => tab.id !== undefined && isStudioChat(tab.url ?? tab.pendingUrl))
    .map((tab) => ({ id: tab.id!, title: tab.title || "AI Studio", url: tab.url ?? tab.pendingUrl ?? "", windowId: tab.windowId }));
}

export async function openStudio(): Promise<void> {
  if (!chrome.tabs?.create) throw new Error("请在安装后的扩展工作台中使用 AI Studio。");
  if (tabId !== undefined) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && isStudioChat(tab.url ?? tab.pendingUrl)) {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  }
  const tab = await chrome.tabs.create({ url: studioUrl, active: true });
  selectStudioTab(tab.id);
}

function selectedId(): number {
  if (tabId === undefined) throw new Error("请刷新标签页列表并选择一个 AI Studio 页面，再连接模型。");
  return tabId;
}

async function readyTab(id: number): Promise<number> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab) throw new Error(`所选 AI Studio 标签页 #${id} 已关闭，请重新选择并连接。`);
    if (tab.status === "complete") {
      if (!isStudioChat(tab.url)) {
        throw new Error(`所选标签页 #${id} 已离开 AI Studio 对话页面，请完成登录或重新选择。`);
      }
      try {
        const ping = await chrome.tabs.sendMessage(id, { channel: "audio-subtitles-studio", action: "ping" });
        if (!ping?.ok) throw new Error("Adapter unavailable");
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: id }, files: ["assets/studio.js"] });
      }
      return id;
    }
    await delay(250);
  }
  throw new Error("AI Studio 页面加载超时，请检查网络或完成登录。");
}

async function request<T>(request: StudioRequest, id: number): Promise<T> {
  await readyTab(id);
  // 始终发往批次固定的 tabId，不广播，也不在失败后换页重发。
  const response = await chrome.tabs.sendMessage(id, { channel: "audio-subtitles-studio", ...request });
  if (!response?.ok) throw new Error(response?.error || "AI Studio 没有返回结果，请重新连接。");
  return response.data as T;
}

export function discoverStudioModels(id = selectedId()): Promise<StudioModelsResult> {
  return request({ action: "models" }, id);
}

export async function organizeInStudio(prompt: string, modelId: string, timeoutSeconds: number, id = selectedId()): Promise<string> {
  const result = await request<StudioPromptResult>({ action: "run", prompt, modelId, timeoutMs: timeoutSeconds * 1000 }, id);
  if (!result.ok) throw new Error(result.error || "AI Studio 生成失败");
  return result.text;
}
