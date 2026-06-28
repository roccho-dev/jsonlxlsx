const encoder = new TextEncoder();
const decoder = new TextDecoder();

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = Object.freeze(Object.fromEntries([...BASE64_ALPHABET].map((ch, index) => [ch, index])));

function isBytes(value) {
  return value instanceof Uint8Array;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value ?? ''));
}

function utf8Encode(text) {
  return encoder.encode(String(text ?? ''));
}

function utf8Decode(bytes) {
  return decoder.decode(toUint8Array(bytes));
}

function concatBytes(parts) {
  const arrays = parts.map(toUint8Array);
  const total = arrays.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesEqual(a, b) {
  const aa = toUint8Array(a);
  const bb = toUint8Array(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

function base64Encode(input) {
  const bytes = toUint8Array(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64_ALPHABET[(n >>> 18) & 63];
    out += BASE64_ALPHABET[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(n >>> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[n & 63] : '=';
  }
  return out;
}

function base64Decode(text) {
  const compact = String(text ?? '').replace(/\s+/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) {
    throw new Error('invalid base64 text');
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((compact.length / 4) * 3 - padding);
  let pos = 0;
  for (let i = 0; i < compact.length; i += 4) {
    const a = BASE64_LOOKUP[compact[i]];
    const b = BASE64_LOOKUP[compact[i + 1]];
    const c = compact[i + 2] === '=' ? 0 : BASE64_LOOKUP[compact[i + 2]];
    const d = compact[i + 3] === '=' ? 0 : BASE64_LOOKUP[compact[i + 3]];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (pos < out.length) out[pos++] = (n >>> 16) & 255;
    if (pos < out.length) out[pos++] = (n >>> 8) & 255;
    if (pos < out.length) out[pos++] = n & 255;
  }
  return out;
}

function hex(bytes) {
  return [...toUint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const K256 = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256Hex(input) {
  const bytes = toUint8Array(input);
  const bitLenHi = Math.floor((bytes.length * 8) / 0x100000000);
  const bitLenLo = (bytes.length * 8) >>> 0;
  const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return hex(out);
}

export { isBytes, toUint8Array, utf8Encode, utf8Decode, concatBytes, bytesEqual, base64Encode, base64Decode, hex, sha256Hex };
