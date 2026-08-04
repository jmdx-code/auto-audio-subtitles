import { useStorageLocal } from "@webextkits/storage-local";

import { schema, type SchemaType } from "@/schema";
import { defaultSettings } from "@/schema/settings";
import type { AppSettings } from "@/types";

const storage = useStorageLocal<SchemaType>(schema);

export async function loadSettings(): Promise<AppSettings> {
  try {
    return await storage.getBucket("settings", { autoFillDefault: true });
  } catch {
    return structuredClone(defaultSettings);
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await storage.setBucket("settings", settings);
}
