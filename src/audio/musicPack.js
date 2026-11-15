// The container licensed music is shipped in: four magic bytes, a four-byte seed and the
// audio bytes XORed with a keystream grown from that seed.
//
// This is not protection. It exists because the music licence asks that the audio be part of
// the game and not sit on the server as files anyone can play as they are: a pack is not a
// playable audio file until the game unpacks it. tools/pack_licensed_music.mjs writes packs
// with these same functions.

const MAGIC = [0x4a, 0x51, 0x4d, 0x31]; // "JQM1"
const HEADER_BYTES = 8;

function keystream(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state & 0xff;
  };
}

export function encodeMusicPack(audioBytes, seed) {
  const pack = new Uint8Array(HEADER_BYTES + audioBytes.length);
  pack.set(MAGIC, 0);
  new DataView(pack.buffer).setUint32(4, seed >>> 0, true);
  const next = keystream(seed);
  for (let index = 0; index < audioBytes.length; index += 1) pack[HEADER_BYTES + index] = audioBytes[index] ^ next();
  return pack;
}

export function isMusicPack(packBytes) {
  return packBytes.length > HEADER_BYTES && MAGIC.every((byte, index) => packBytes[index] === byte);
}

export function decodeMusicPack(packBytes) {
  if (!isMusicPack(packBytes)) throw new Error("Not a JiuQuest music pack.");
  const seed = new DataView(packBytes.buffer, packBytes.byteOffset, packBytes.byteLength).getUint32(4, true);
  const next = keystream(seed);
  const audio = new Uint8Array(packBytes.length - HEADER_BYTES);
  for (let index = 0; index < audio.length; index += 1) audio[index] = packBytes[HEADER_BYTES + index] ^ next();
  return audio;
}
