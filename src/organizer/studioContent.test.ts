import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (message: unknown, sender: unknown, response: (value: unknown) => void) => unknown;
let listener: Listener;
let paid = false;
let turns: unknown[];
let runClick: ReturnType<typeof vi.fn>;
let answerDelay = 0;
let temporary = false;
let temporaryAvailable = true;
let clearWorks = true;
let clearClick: ReturnType<typeof vi.fn>;
let temporaryClick: ReturnType<typeof vi.fn>;
let promptValue = "";
let submittedPrompts: string[];
let confirmationRequired = false;
let confirmationPending = false;
let discardClick: ReturnType<typeof vi.fn>;


beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete (globalThis as Record<string, unknown>).__audioSubtitlesStudio;
  turns = [];
  paid = false;
  answerDelay = 0;
  temporary = false;
  temporaryAvailable = true;
  clearWorks = true;
  promptValue = "";
  submittedPrompts = [];
  confirmationRequired = false;
  confirmationPending = false;
  discardClick = vi.fn(() => { confirmationPending = false; turns = []; promptValue = ""; });
  clearClick = vi.fn(() => {
    if (confirmationRequired && turns.length) { confirmationPending = true; return; }
    if (clearWorks) { turns = []; promptValue = ""; temporary = false; }
  });
  temporaryClick = vi.fn(() => { temporary = true; });
  const answerTurn = {
    classList: { contains: () => true },
    querySelector: () => null,
    querySelectorAll: () => [{ innerText: "မင်္ဂလာပါ။\nနေကောင်းပါသလား။", closest: () => null }],
  };
  runClick = vi.fn(() => {
    submittedPrompts.push(promptValue);
    turns.push({
      classList: { contains: () => true },
      querySelector: (selector: string) => selector === ".turn-content"
        ? { innerText: "Model 11:06 AM\nThoughts\nExpand to view model thoughts" } : null,
      querySelectorAll: () => [],
    });
    if (answerDelay) setTimeout(() => turns.push(answerTurn), answerDelay);
    else turns.push(answerTurn);
  });
  const modelRow = { querySelector: (selector: string) => selector === ".model-subtitle"
    ? { textContent: "gemini-test" } : selector === ".model-title-text"
      ? { textContent: "Test" } : selector === ".badge.paid" && paid ? {} : null };
  const dialog = { closest: () => null, querySelectorAll: (selector: string) =>
    selector === "ms-model-carousel-row" ? [modelRow] : [] };
  const textarea = { dispatchEvent: vi.fn(), get value() { return promptValue; } };
  class Textarea { set value(value: string) { promptValue = value; } }
  vi.stubGlobal("HTMLTextAreaElement", Textarea);
  vi.stubGlobal("InputEvent", class {});
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { hostname: "aistudio.google.com", origin: "https://aistudio.google.com" });
  vi.stubGlobal("chrome", { runtime: { id: "self", getURL: (path: string) => `chrome-extension://self/${path}`, onMessage: { addListener: (fn: Listener) => { listener = fn; } } } });
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      if (selector.includes("aria-label='New chat'")) return { getAttribute: () => "false", click: clearClick };
      if (selector.includes("incognito-icon")) return temporary ? {} : null;
      if (selector.includes("View more actions")) return { click: vi.fn() };
      if (selector.includes("data-test-incognito-toggle")) return temporaryAvailable ? { getAttribute: () => "false", click: temporaryClick } : null;
      if (selector.includes("model-carousel")) return dialog;
      if (selector.includes("model-name")) return { textContent: "gemini-test" };
      if (selector.includes("textarea")) return textarea;
      if (selector.includes("ctrl-enter-submits")) return { getAttribute: () => "false", click: runClick };
      return null;
    },
    querySelectorAll: (selector: string) => {
      if (selector.includes("ms-chat-turn")) return turns;
      if (selector.includes("mat-dialog-container") && confirmationPending) return [{
        textContent: "Create a new chat Content of your current prompt will be deleted",
        querySelectorAll: () => [{ textContent: "Discard and continue", getAttribute: () => "false", click: discardClick }],
      }];
      return [];
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).__audioSubtitlesStudio;
});

describe("AI Studio page adapter", () => {
  it("rejects messages from same-extension content scripts and malformed run payloads", async () => {
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "models" },
      { id: "self", url: "https://aistudio.google.com/prompts/new_chat" }, response);
    expect(response).not.toHaveBeenCalled();
    listener({ channel: "audio-subtitles-studio", action: "run", prompt: "test", modelId: "gemini-test", timeoutMs: NaN },
      { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    expect(response).toHaveBeenCalledWith({ ok: false, error: "无效请求" });
    expect(clearClick).not.toHaveBeenCalled();
    expect(runClick).not.toHaveBeenCalled();
  });

  it("rejects a hostname suffix lookalike before changing the page", async () => {
    vi.stubGlobal("location", { origin: "https://evilaistudio.google.com", hostname: "evilaistudio.google.com" });
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", prompt: "test", modelId: "gemini-test", timeoutMs: 30_000 },
      { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    expect(response).not.toHaveBeenCalled();
    expect(clearClick).not.toHaveBeenCalled();
  });
  it("reads a multiline final reply without collapsing subtitle breaks", async () => {
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "test", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    await vi.advanceTimersByTimeAsync(2500);
    expect(runClick).toHaveBeenCalledOnce();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true,
      data: expect.objectContaining({ text: "မင်္ဂလာပါ။\nနေကောင်းပါသလား။" }) }));
  });

  it("waits for the separate final answer instead of returning the thoughts panel", async () => {
    answerDelay = 5000;
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "test", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    await vi.advanceTimersByTimeAsync(3000);
    expect(response).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4500);
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true,
      data: expect.objectContaining({ text: "မင်္ဂလာပါ။\nနေကောင်းပါသလား။" }) }));
  });

  it("starts a new temporary chat for each row, clearing prior answers and prompts", async () => {
    turns.push({ stale: "previous conversation" });
    promptValue = "unsent previous prompt";
    await import("./studioContent");
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "first row", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, firstResponse);
    await vi.advanceTimersByTimeAsync(2500);
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "second row", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, secondResponse);
    await vi.advanceTimersByTimeAsync(2500);
    expect(clearClick).toHaveBeenCalledTimes(2);
    expect(temporaryClick).toHaveBeenCalledTimes(2);
    expect(submittedPrompts).toEqual(["first row", "second row"]);
    expect(turns).toHaveLength(2);
    expect(firstResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(secondResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("handles the new-chat discard prompt before sending the next row", async () => {
    turns.push({ stale: "previous temporary reply" });
    temporary = true;
    confirmationRequired = true;
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "next row", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    await vi.advanceTimersByTimeAsync(2500);
    expect(discardClick).toHaveBeenCalledOnce();
    expect(temporaryClick).not.toHaveBeenCalled();
    expect(submittedPrompts).toEqual(["next row"]);
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("does not submit if the old conversation could not be cleared", async () => {
    turns.push({ stale: "previous conversation" });
    clearWorks = false;
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "test", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(runClick).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("旧会话未清空") }));
  });

  it("does not submit if temporary chat cannot be enabled", async () => {
    temporaryAvailable = false;
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "test", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    await vi.advanceTimersByTimeAsync(6000);
    expect(runClick).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("临时会话开关") }));
  });

  it("refuses paid models before submitting any prompt", async () => {
    paid = true;
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "run", modelId: "gemini-test", prompt: "test", timeoutMs: 30_000 }, { id: "self", url: "chrome-extension://self/workbench.html" }, response);
    await vi.advanceTimersByTimeAsync(1);
    expect(runClick).not.toHaveBeenCalled();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("免费") }));
  });

  it("does not accept messages from another extension", async () => {
    await import("./studioContent");
    const response = vi.fn();
    listener({ channel: "audio-subtitles-studio", action: "models" }, { id: "other" }, response);
    expect(response).not.toHaveBeenCalled();
  });
});
