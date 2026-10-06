export type VoiceInfo = {
  shortName: string;
  friendlyName: string;
  locale: string;
  gender: "Female" | "Male";
};

export type AppSettings = {
  studioModelId: string;
  studioIntervalSeconds: number;
  studioTimeoutSeconds: number;
  selectedVoice: string;
  rate: number;
  pitch: number;
  maxSegmentSeconds: number;
  startSequence: number;
  previewText: string;
  voiceCache: VoiceInfo[];
  voiceCacheUpdatedAt: number;
};

export type ProjectStatus =
  | "idle"
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "failed";

export type ProjectRow = {
  id: string;
  rawText?: string;
  organizeDetail?: string;
  text: string;
  name: string;
  status: ProjectStatus;
  progress: number;
  detail: string;
  error?: string;
};

export type SynthesisOptions = {
  voice: string;
  rate: string;
  pitch: string;
};

export type SegmentInfo = {
  text: string;
  tempFileName: string;
  duration: number;
};

export type GeneratedFile = {
  name: string;
  data: Uint8Array | string;
};

export type JobDefinition = {
  rowId: string;
  text: string;
  name: string;
  sequence: number;
  folderName: string;
};
