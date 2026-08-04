import { defaultSettings } from "@/schema/settings";

const STORAGE_KEY = "__auto_audio_subtitles_dev_storage__";

export function installDevelopmentChromeMock(): void {
  if (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime?.getURL === "function" &&
    Boolean(chrome.storage?.local)
  )
    return;
  const initialSettings = {
    ...defaultSettings,
    voiceCache: [
      {
        shortName: "my-MM-NilarNeural",
        friendlyName: "Microsoft Nilar Online (Natural)",
        locale: "my-MM",
        gender: "Female" as const,
      },
      {
        shortName: "zh-CN-XiaoxiaoNeural",
        friendlyName: "Microsoft Xiaoxiao Online (Natural)",
        locale: "zh-CN",
        gender: "Female" as const,
      },
      {
        shortName: "en-US-GuyNeural",
        friendlyName: "Microsoft Guy Online (Natural)",
        locale: "en-US",
        gender: "Male" as const,
      },
    ],
    voiceCacheUpdatedAt: Date.now(),
  };

  if (!localStorage.getItem(STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: initialSettings }));
  }

  const storageArea = {
    async get(
      keys?: string | string[] | Record<string, unknown> | null,
      callback?: (items: Record<string, unknown>) => void,
    ) {
      const all = readStorage();
      const result =
        keys == null
          ? all
          : typeof keys === "string"
            ? { [keys]: all[keys] }
            : Array.isArray(keys)
              ? Object.fromEntries(keys.map((key) => [key, all[key]]))
              : { ...keys, ...all };
      callback?.(result);
      return result;
    },
    async set(items: Record<string, unknown>) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStorage(), ...items }));
    },
    async remove(keys: string | string[]) {
      const all = readStorage();
      for (const key of Array.isArray(keys) ? keys : [keys]) delete all[key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    },
  };

  const mockChrome = {
    runtime: {
      getManifest: () => ({ name: "自动音频字幕", version: "0.1.0" }),
      getURL: (path: string) => new URL(`/${path}`, location.origin).href,
      onInstalled: { addListener: () => undefined },
    },
    storage: { local: storageArea },
  };
  if (typeof chrome === "undefined") {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: mockChrome,
    });
  } else {
    Object.assign(chrome as unknown as Record<string, unknown>, mockChrome);
  }
}

function readStorage(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
}
