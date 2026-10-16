// Browser TypeScript port of edge-tts 7.3.1 src/edge_tts/drm.py (LGPL-3.0).
// Copyright (c) rany and contributors. See licenses/EDGE-TTS-LGPL-3.0.txt.
// https://github.com/rany2/edge-tts/blob/7.3.1/src/edge_tts/drm.py
import { INITIAL, STATE, SCHEDULE, ROUND_CONSTANTS, COEFFICIENTS } from './tokenConstants';

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const SEC_MS_GEC_VERSION = '2-143.0.3650.75';
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
const rol16 = (value: number) => rotate(value, 16) >>> 0;
const sigma0 = (value: number) => (rotate(value, 7) ^ rotate(value, 18) ^ (value >>> 3)) >>> 0;
const sigma1 = (value: number) => (rotate(value, 17) ^ rotate(value, 19) ^ (value >>> 10)) >>> 0;

function expand(words: number[], from = 16): void {
  for (let index = from; index < 64; index++) {
    words[index] = (sigma1(words[index - 2]) + words[index - 7]
      + sigma0(words[index - 15]) + words[index - 16]) >>> 0;
  }
}

function rounds(state: readonly number[], words: number[], from = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  for (let index = from; index < 64; index++) {
    const constant = from === 14 && index === 14 ? 0xc9dc06a7 : ROUND_CONSTANTS[index];
    const t1 = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
      + (g ^ (e & (f ^ g))) + constant + words[index];
    const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) | (c & (a | b)));
    [a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

function sha256(data: Uint8Array): Uint8Array {
  const words = Array<number>(14).fill(0);
  words.push(data[0] * 65536 + data[1] * 256 + data[2]);
  words.push(new DataView(data.buffer, data.byteOffset).getUint32(3));
  for (let index = 16; index < 30; index++) {
    let value = SCHEDULE[index - 16];
    if (index - 2 >= 14) value += (sigma1(words[index - 2]) ^ (index === 16 ? 0x000b92c0 : 0)) >>> 0;
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) value += (sigma0(words[index - 15]) ^ (index === 29 ? 0x059c0b80 : 0)) >>> 0;
    words.push(value >>> 0);
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14]
    + 0xc9dc06a7 - ROUND_CONSTANTS[14]) >>> 0);
  expand(words, 31);
  let state = rounds(STATE, words, 14).map((value, index) => (value + INITIAL[index]) >>> 0);
  const length = 57 + data.length;
  const remaining = data.subarray(7);
  const padded = new Uint8Array(remaining.length + 1 + ((55 - length) % 64 + 64) % 64 + 8);
  padded.set(remaining);
  padded[remaining.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(length * 8));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const block = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4));
    expand(block);
    state = rounds(state, block).map((value, index) => (value + state[index]) >>> 0);
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  state.forEach((word, index) => digestView.setUint32(index * 4, word));
  return digest;
}

function cs64(data: Uint8Array, digest: Uint8Array): Uint8Array {
  const digestView = new DataView(digest.buffer);
  const keys = [digestView.getUint32(0, true) | 1, digestView.getUint32(4, true) | 1];
  const factors = keys.map(key => Math.imul(key, 0x82893933));
  const terms = COEFFICIENTS.map(([coefficient], index) => Math.imul(coefficient, factors[index % 2]) >>> 0);
  const offsets: number[] = COEFFICIENTS.map(([, offset]) => offset);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 8) * 8);
  padded.set(data, 1);
  const view = new DataView(padded.buffer);
  for (let index = 0; index < padded.length / 4; index++) {
    const word = view.getUint32(index * 4, true);
    let term = Math.imul(word, keys[index % 2]);
    let offset = Math.imul(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term += Math.imul(0xf2f90b1a, factors[0]);
      offset += 0x0b1a0000;
    }
    terms.push(term >>> 0);
    offsets.push(offset >>> 0);
  }
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index], y = terms[index + 1];
    let q = Math.imul(rol16((offsets[index] + x) >>> 0), 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + Math.imul(rol16(q), 0xc3efea97) + q) >>> 0;
    q = Math.imul(rol16((offsets[index + 1] + y) >>> 0), 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;
    state = (Math.imul(state, keys[0]) + x) >>> 0;
    for (const factor of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) {
      state = Math.imul(rol16(state), factor) >>> 0;
    }
    acc = (acc + state) >>> 0;
    let t = (Math.imul(state, keys[1]) + y) >>> 0;
    for (const factor of [0xa27416f5, 0xd38396ff, 0x7c932b89, 0xbfa49f69]) {
      t = Math.imul(rol16(t), factor) >>> 0;
    }
    state = t;
    acc = (acc + state) >>> 0;
  }
  const result = new Uint8Array(8);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, (swapLast ^ state) >>> 0, true);
  resultView.setUint32(4, (swapAcc ^ acc) >>> 0, true);
  return result;
}

const hex = (data: Uint8Array) => Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();

export function generateToken(unixSeconds = Date.now() / 1000): string {
  if (!Number.isFinite(unixSeconds)) throw new Error('无效的系统时间。');
  let ticks = unixSeconds + 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const data = new TextEncoder().encode(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`);
  const digest = sha256(data);
  return `${hex(cs64(data, digest))}-${hex(digest)}`;
}
