import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabs = [
  { id: 11, windowId: 1, title: "First chat", url: "https://aistudio.google.com/prompts/first", status: "complete" },
  { id: 22, windowId: 2, title: "Second chat", url: "https://aistudio.google.com/prompts/second", status: "complete" },
  { id: 33, windowId: 1, title: "App editor", url: "https://aistudio.google.com/apps/third", status: "complete" },
];
let sendMessage: ReturnType<typeof vi.fn>;
let getTab: ReturnType<typeof vi.fn>;
let createTab: ReturnType<typeof vi.fn>;
let store: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  store = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
  getTab = vi.fn(async (id: number) => {
    const tab = tabs.find((tab) => tab.id === id);
    if (!tab) throw new Error("Closed");
    return tab;
  });
  createTab = vi.fn();
  sendMessage = vi.fn(async (_id: number, message: { action: string }) => message.action === "ping"
    ? { ok: true } : message.action === "models"
      ? { ok: true, data: { currentModelId: "gemini-test", models: [] } }
      : { ok: true, data: { ok: true, text: "မင်္ဂလာပါ။\nနေကောင်းပါသလား။", error: "", elapsedMs: 1 } });
  vi.stubGlobal("chrome", { tabs: { query: vi.fn(async () => tabs), get: getTab, sendMessage, create: createTab }, scripting: { executeScript: vi.fn() } });
});

afterEach(() => vi.unstubAllGlobals());

describe("multiple AI Studio tabs", () => {
  it("lists chat pages across windows without picking another page implicitly", async () => {
    const client = await import("./studioClient");
    expect((await client.listStudioTabs()).map((tab) => tab.id)).toEqual([11, 22]);
    expect(() => client.discoverStudioModels()).toThrow("选择");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });

  it("keeps the batch bound to its original tab even if a different tab is later selected", async () => {
    const client = await import("./studioClient");
    client.selectStudioTab(22);
    await client.discoverStudioModels();
    const batchTab = client.getSelectedStudioTabId();
    client.selectStudioTab(11);
    const result = await client.organizeInStudio("test", "gemini-test", 180, batchTab);
    expect(result).toContain("\n");
    expect(sendMessage.mock.calls.every(([id]) => id === 22)).toBe(true);
  });

  it("fails when the pinned tab is closed, without sending to a remaining tab", async () => {
    const client = await import("./studioClient");
    client.selectStudioTab(22);
    getTab.mockRejectedValue(new Error("Closed"));
    await expect(client.organizeInStudio("test", "gemini-test", 180, 22)).rejects.toThrow("#22 已关闭");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });

  it("restores the explicit tab choice after a workbench reload", async () => {
    const client = await import("./studioClient");
    client.selectStudioTab(22);
    vi.resetModules();
    const restored = await import("./studioClient");
    expect(restored.getSelectedStudioTabId()).toBe(22);
    await restored.discoverStudioModels();
    expect(sendMessage.mock.calls.every(([id]) => id === 22)).toBe(true);
  });
});
