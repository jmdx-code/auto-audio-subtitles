import type { JSONSchemaType } from "@webextkits/storage-local";

import {
  DEFAULT_PREVIEW_TEXT,
  DEFAULT_VOICE,
} from "@/const";
import type { AppSettings } from "@/types";

export const defaultSettings: AppSettings = {
  studioModelId: "",
  studioIntervalSeconds: 5,
  studioTimeoutSeconds: 180,
  selectedVoice: DEFAULT_VOICE,
  rate: 0,
  pitch: 0,
  maxSegmentSeconds: 30,
  startSequence: 1,
  previewText: DEFAULT_PREVIEW_TEXT,
  voiceCache: [],
  voiceCacheUpdatedAt: 0,
};

export const settingsSchema: JSONSchemaType<AppSettings> = {
  type: "object",
  properties: {
    studioModelId: { type: "string", default: "" },
    studioIntervalSeconds: { type: "number", default: 5 },
    studioTimeoutSeconds: { type: "number", default: 180 },
    selectedVoice: { type: "string", default: DEFAULT_VOICE },
    rate: { type: "number", default: 0 },
    pitch: { type: "number", default: 0 },
    maxSegmentSeconds: { type: "number", default: 30 },
    startSequence: { type: "number", default: 1 },
    previewText: { type: "string", default: DEFAULT_PREVIEW_TEXT },
    voiceCache: {
      type: "array",
      default: [],
      items: {
        type: "object",
        properties: {
          shortName: { type: "string" },
          friendlyName: { type: "string" },
          locale: { type: "string" },
          gender: { type: "string", enum: ["Female", "Male"] },
        },
        required: ["shortName", "friendlyName", "locale", "gender"],
      },
    },
    voiceCacheUpdatedAt: { type: "number", default: 0 },
  },
  required: [
    "studioModelId",
    "studioIntervalSeconds",
    "studioTimeoutSeconds",
    "selectedVoice",
    "rate",
    "pitch",
    "maxSegmentSeconds",
    "startSequence",
    "previewText",
    "voiceCache",
    "voiceCacheUpdatedAt",
  ],
};
