import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeTtsProvider, splitSpeechText } from './EdgeTtsProvider';
import { TaskController } from '@/jobs/TaskController';

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  binaryType = '';
  send = vi.fn();
  close = vi.fn();
  constructor(readonly url: string) { super(); FakeSocket.instances.push(this); }
  message(data: unknown) { this.onmessage?.({ data }); }
}

function audioFrame(bytes = [1, 2, 3], contentType = 'audio/mpeg'): ArrayBuffer {
  const headers = new TextEncoder().encode(`Path:audio\r\nContent-Type:${contentType}\r\n`);
  const result = new ArrayBuffer(2 + headers.length + bytes.length);
  new DataView(result).setUint16(0, headers.length);
  new Uint8Array(result).set(headers, 2);
  new Uint8Array(result).set(bytes, 2 + headers.length);
  return result;
}
const options = { voice: 'my-MM-NilarNeural', rate: '+0%', pitch: '+0Hz' };
const provider = new EdgeTtsProvider();
const socket = () => FakeSocket.instances.at(-1)!;

beforeEach(() => { FakeSocket.instances = []; vi.stubGlobal('WebSocket', FakeSocket); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Edge TTS native transport', () => {
  it('uses v2 authentication and resolves only after the complete turn', async () => {
    const result = provider.synthesize('မင်္ဂလာပါ။ <&', options);
    const ws = socket();
    const url = new URL(ws.url);
    expect(url.searchParams.get('Sec-MS-GEC-Version')).toMatch(/^2-/);
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[A-F0-9]{16}-[A-F0-9]{64}$/);
    expect(ws.binaryType).toBe('arraybuffer');
    ws.onopen?.();
    expect(ws.send.mock.calls[1][0]).toContain('မင်္ဂလာပါ။ &lt;&amp;');
    ws.message(audioFrame());
    ws.message('Path:turn.end\r\n\r\n');
    const blob = await result;
    expect(blob.type).toBe('audio/mpeg');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(ws.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a handshake error immediately and cleans up', async () => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow('无法连接');
    socket().onerror?.();
    await failed;
    expect(socket().close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('rejects premature close (opened: %s), even with partial audio', async opened => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow('提前关闭');
    if (opened) { socket().onopen?.(); socket().message(audioFrame()); }
    socket().onclose?.({ code: 1006 });
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a stalled handshake', async () => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow('15 秒');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(socket().close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out when no data arrives after opening', async () => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow('30 秒');
    socket().onopen?.();
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the total request even if keepalive messages continue', async () => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow('120 秒');
    socket().onopen?.();
    for (let index = 0; index < 5; index++) {
      await vi.advanceTimersByTimeAsync(20_000);
      socket().message('Path:response\r\n\r\n');
    }
    await vi.advanceTimersByTimeAsync(20_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('aborts the active connection (opened: %s) through TaskController', async opened => {
    const controller = new TaskController();
    const result = provider.synthesize('test', { ...options, signal: controller.signal });
    const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    if (opened) socket().onopen?.();
    controller.cancel();
    await cancelled;
    await expect(controller.checkpoint()).rejects.toThrow('任务已取消');
    expect(socket().close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not connect for an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(provider.synthesize('test', { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('rejects empty audio', async () => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow('没有返回音频');
    socket().onopen?.(); socket().message('Path:turn.end\r\n\r\n');
    await failed;
  });

  it.each([new ArrayBuffer(1), new Uint8Array([0, 10, 0]).buffer, audioFrame([1], 'invalid')])('rejects malformed audio frames', async frame => {
    const result = provider.synthesize('test', options);
    const failed = expect(result).rejects.toThrow();
    socket().onopen?.(); socket().message(frame);
    await failed;
    expect(socket().close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a socket constructor failure', async () => {
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('blocked'); } });
    await expect(provider.synthesize('test', options)).rejects.toThrow('无法连接');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid input without opening a socket', async () => {
    await expect(provider.synthesize('   ', options)).rejects.toThrow('没有可生成');
    await expect(provider.synthesize('test', { ...options, voice: "x'><script>" })).rejects.toThrow('参数无效');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('combines ordered audio when a long line requires multiple requests', async () => {
    const result = provider.synthesize('က'.repeat(1500), options);
    socket().onopen?.(); socket().message(audioFrame([1])); socket().message('Path:turn.end\r\n\r\n');
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(2);
    socket().onopen?.(); socket().message(audioFrame([2])); socket().message('Path:turn.end\r\n\r\n');
    expect(Array.from(new Uint8Array(await (await result).arrayBuffer()))).toEqual([1, 2]);
  });
});

describe('speech text framing', () => {
  it('preserves Myanmar and emoji, escapes XML and keeps frames small', () => {
    const text = ('က😀<&').repeat(1600);
    const chunks = splitSpeechText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => new TextEncoder().encode(chunk).length <= 3000)).toBe(true);
    expect(chunks.join('')).toBe(('က😀&lt;&amp;').repeat(1600));
    expect(splitSpeechText('\0က\n')).toEqual(['က']);
  });
});

describe('voice list', () => {
  it('validates and maps available voices using v2', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { ShortName: 'my-MM-NilarNeural', FriendlyName: 'Nilar', Locale: 'my-MM', Gender: 'Female' },
      { ShortName: 'invalid' },
    ])));
    vi.stubGlobal('fetch', fetchMock);
    expect(await provider.listVoices()).toEqual([{ shortName: 'my-MM-NilarNeural', friendlyName: 'Nilar', locale: 'my-MM', gender: 'Female' }]);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('Sec-MS-GEC-Version')).toMatch(/^2-/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(provider.listVoices()).rejects.toThrow('HTTP 403');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts a stalled voice list request', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const failed = expect(provider.listVoices()).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });
});
