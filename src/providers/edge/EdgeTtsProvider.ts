import { EdgeTTS, listVoices } from "edge-tts-universal/browser";

import type { SynthesisOptions, VoiceInfo } from "@/types";
import type { TtsProvider } from "@/providers/types";

export class EdgeTtsProvider implements TtsProvider {
  async listVoices(): Promise<VoiceInfo[]> {
    const voices = await listVoices();
    return voices
      .map((voice) => ({
        shortName: voice.ShortName,
        friendlyName: voice.FriendlyName,
        locale: voice.Locale,
        gender: voice.Gender,
      }))
      .sort((left, right) =>
        `${left.locale}-${left.friendlyName}`.localeCompare(
          `${right.locale}-${right.friendlyName}`,
        ),
      );
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<Blob> {
    const tts = new EdgeTTS(text, options.voice, {
      rate: options.rate,
      pitch: options.pitch,
      volume: "+0%",
    });
    const result = await tts.synthesize();
    if (!result.audio.size) throw new Error("Edge TTS 没有返回音频数据。");
    return result.audio;
  }
}
