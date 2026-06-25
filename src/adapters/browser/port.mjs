import { toUint8Array } from '../../core/binary.mjs';

async function streamCodec(bytes, StreamCtor, format) {
  if (typeof StreamCtor !== 'function') throw new Error(`${format} stream API is not available in this browser runtime`);
  const stream = new StreamCtor(format);
  const writer = stream.writable.getWriter();
  await writer.write(toUint8Array(bytes));
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function browserSha256(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('WebCrypto subtle digest is not available in this browser runtime');
  const digest = await subtle.digest('SHA-256', toUint8Array(bytes));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const browserPort = Object.freeze({
  runtime: 'browser',
  deflateRaw: bytes => streamCodec(bytes, globalThis.CompressionStream, 'deflate-raw'),
  inflateRaw: bytes => streamCodec(bytes, globalThis.DecompressionStream, 'deflate-raw'),
  sha256: browserSha256
});

export { browserPort };
