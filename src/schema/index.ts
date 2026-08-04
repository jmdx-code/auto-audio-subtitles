import { settingsSchema } from "./settings";
import type { AppSettings } from "@/types";

export type SchemaType = {
  settings: AppSettings;
};

export const schema = {
  settings: settingsSchema,
};
