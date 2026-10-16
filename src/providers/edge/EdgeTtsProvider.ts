import type { SynthesisOptions, VoiceInfo } from '@/types';
import type { TtsProvider } from '@/providers/types';
import { generateToken, SEC_MS_GEC_VERSION, TRUSTED_CLIENT_TOKEN } from './token';

const BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const CONNECTION_TIMEOUT = 15_000;
const IDLE_TIMEOUT = 30_000;
const REQUEST_TIMEOUT = 120_000;
const NETWORK_ERROR = '无法连接微软语音服务，请检查网络或代理后重试。';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const escapeXml = (text: string) => text.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const abortError = () => new DOMException('语音请求已取消', 'AbortError');

// Bound the escaped UTF-8 payload, without splitting a Unicode code point.
export function splitSpeechText(text: string): string[] {
  const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  const chunks: string[] = [];
  let chunk = '', bytes = 0;
  for (const char of cleaned) {
    const escaped = escapeXml(char);
    const size = encoder.encode(escaped).length;
    // Leave room for SSML and protocol headers within the service's frame limit.
    if (bytes + size > 3000) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += escaped;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function parameters(): URLSearchParams {
  return new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    'Sec-MS-GEC': generateToken(),
    'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
  });
}

export class EdgeTtsProvider implements TtsProvider {
  async listVoices(): Promise<VoiceInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT);
    try {
      const response = await fetch(`https://${BASE}/voices/list?${parameters()}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`音色列表请求失败（HTTP ${response.status}）。`);
      const voices: unknown = await response.json();
      if (!Array.isArray(voices)) throw new Error('微软语音服务返回了无效的音色列表。');
      const result: VoiceInfo[] = [];
      for (const voice of voices) {
        if (typeof voice?.ShortName !== 'string' || typeof voice?.FriendlyName !== 'string'
          || typeof voice?.Locale !== 'string' || !['Female', 'Male'].includes(voice?.Gender)) continue;
        result.push({ shortName: voice.ShortName, friendlyName: voice.FriendlyName,
          locale: voice.Locale, gender: voice.Gender });
      }
      if (!result.length) throw new Error('微软语音服务没有返回可用音色。');
      return result.sort((a, b) => `${a.locale}-${a.friendlyName}`.localeCompare(`${b.locale}-${b.friendlyName}`));
    } catch (error) {
      if (controller.signal.aborted) throw new Error('音色列表请求超时，请检查网络或代理。');
      if (error instanceof TypeError) throw new Error(NETWORK_ERROR, { cause: error });
      throw error;
    } finally { clearTimeout(timer); }
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<Blob> {
    if (options.signal?.aborted) throw abortError();
    if (!/^[a-z]{2,3}-[a-zA-Z0-9-]+Neural$/.test(options.voice)
      || !/^[+-]\d+%$/.test(options.rate) || !/^[+-]\d+Hz$/.test(options.pitch)) {
      throw new Error('音色、语速或音调参数无效，请重新选择音色。');
    }
    const texts = splitSpeechText(text);
    if (!texts.length) throw new Error('没有可生成语音的文案。');
    const chunks: Blob[] = [];
    for (const escapedText of texts) {
      if (options.signal?.aborted) throw abortError();
      chunks.push(await this.synthesizeChunk(escapedText, options));
    }
    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  private synthesizeChunk(text: string, options: SynthesisOptions): Promise<Blob> {
    const params = parameters();
    params.set('ConnectionId', crypto.randomUUID().replaceAll('-', ''));
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(`wss://${BASE}/edge/v1?${params}`);
        socket.binaryType = 'arraybuffer';
      } catch (error) { reject(new Error(NETWORK_ERROR, { cause: error })); return; }
      const audio: ArrayBuffer[] = [];
      let audioSize = 0, settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const connectTimer = setTimeout(() => finish(new Error('连接微软语音服务超时（15 秒），请检查网络或代理。')), CONNECTION_TIMEOUT);
      const requestTimer = setTimeout(() => finish(new Error('微软语音合成超时（120 秒）。')), REQUEST_TIMEOUT);
      const onAbort = () => finish(abortError());
      const resetIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(new Error('微软语音服务 30 秒未返回数据，请重试。')), IDLE_TIMEOUT);
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(requestTimer);
        clearTimeout(idleTimer);
        options.signal?.removeEventListener('abort', onAbort);
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
        socket.addEventListener('error', () => undefined, { once: true });
        try { socket.close(); } catch { /* Already unavailable. */ }
        if (error) reject(error);
        else if (!audioSize) reject(new Error('微软语音服务没有返回音频数据。'));
        else resolve(new Blob(audio, { type: 'audio/mpeg' }));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) { onAbort(); return; }
      socket.onerror = () => finish(new Error(NETWORK_ERROR));
      socket.onclose = event => finish(new Error(`微软语音连接提前关闭（${event.code}），音频未完整返回，请重试。`));
      socket.onopen = () => {
        clearTimeout(connectTimer);
        resetIdleTimer();
        try {
          const timestamp = new Date().toUTCString();
          socket.send(`X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify({
            context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } },
          })}\r\n`);
          const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${options.voice}'><prosody pitch='${options.pitch}' rate='${options.rate}' volume='+0%'>${text}</prosody></voice></speak>`;
          socket.send(`X-RequestId:${crypto.randomUUID().replaceAll('-', '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp}Z\r\nPath:ssml\r\n\r\n${ssml}`);
        } catch (error) { finish(new Error('发送语音请求失败。', { cause: error })); }
      };
      socket.onmessage = event => {
        resetIdleTimer();
        try {
          if (typeof event.data === 'string') {
            const header = event.data.split('\r\n\r\n', 1)[0];
            if (/^Path:turn\.end\s*$/im.test(header)) finish();
          } else if (event.data instanceof ArrayBuffer) {
            const buffer = event.data;
            if (buffer.byteLength < 2) throw new Error('音频帧缺少长度信息。');
            const headerLength = new DataView(buffer).getUint16(0);
            if (headerLength + 2 > buffer.byteLength) throw new Error('音频帧长度无效。');
            const header = decoder.decode(new Uint8Array(buffer, 2, headerLength));
            if (!/^Path:audio\s*$/im.test(header)) throw new Error('收到未知音频帧。');
            const data = buffer.slice(headerLength + 2);
            if (data.byteLength) {
              if (!/^Content-Type:audio\/mpeg\s*$/im.test(header)) throw new Error('音频格式无效。');
              audio.push(data);
              audioSize += data.byteLength;
              if (audioSize > 32 * 1024 * 1024) throw new Error('单段音频过大，请缩短文案后重试。');
            }
          } else throw new Error('收到未知语音数据格式。');
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      };
    });
  }
}
