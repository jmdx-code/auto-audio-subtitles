import "./styles.css";

const WORKBENCH_PATH = "workbench.html";
const statusElement = document.querySelector<HTMLParagraphElement>("#launcher-status");
const openButton = document.querySelector<HTMLButtonElement>("#launcher-open");

async function openWorkbench(): Promise<void> {
  if (!statusElement || !openButton) return;
  statusElement.textContent = "正在打开工作台…";
  openButton.disabled = true;

  try {
    const workbenchUrl = chrome.runtime.getURL(WORKBENCH_PATH);
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => tab.url === workbenchUrl);

    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      await chrome.tabs.create({ url: workbenchUrl, active: true });
    }

    window.close();
  } catch (error) {
    console.error("无法打开自动音频字幕工作台", error);
    statusElement.textContent = `自动打开失败：${formatError(error)}`;
    openButton.disabled = false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

openButton?.addEventListener("click", () => void openWorkbench());
void openWorkbench();
