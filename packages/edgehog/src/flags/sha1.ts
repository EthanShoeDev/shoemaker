/* oxlint-disable no-bitwise, unicorn/prefer-math-trunc -- SHA-1 is defined on 32-bit words */
import { Array as Arr } from 'effect';

const BLOCK = 64;
const ROUNDS = 80;
const LENGTH_BYTES = 8;
const WORD = 32;

const rotate = (value: number, bits: number) =>
  (value << bits) | (value >>> (WORD - bits));

// Which word function and constant a round uses.
const mix = (round: number, b: number, c: number, d: number) => {
  if (round < 20) return ((b & c) | (~b & d)) + 0x5a_82_79_99;
  if (round < 40) return (b ^ c ^ d) + 0x6e_d9_eb_a1;
  if (round < 60) return ((b & c) | (b & d) | (c & d)) + 0x8f_1b_bc_dc;
  return (b ^ c ^ d) + 0xca_62_c1_d6;
};

const pad = (bytes: Uint8Array) => {
  const length = Math.ceil((bytes.length + 1 + LENGTH_BYTES) / BLOCK) * BLOCK;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(length - LENGTH_BYTES, BigInt(bytes.length * 8));
  return view;
};

// The five words of the digest. Synchronous on every runtime, which Web Crypto
// is not and evaluating a flag has to be. Nothing secret depends on it.
export const sha1 = (bytes: Uint8Array): ReadonlyArray<number> => {
  const view = pad(bytes);
  const state = [
    0x67_45_23_01, 0xef_cd_ab_89, 0x98_ba_dc_fe, 0x10_32_54_76, 0xc3_d2_e1_f0,
  ];
  const words = new Int32Array(ROUNDS);
  for (let block = 0; block < view.byteLength; block += BLOCK) {
    let [a = 0, b = 0, c = 0, d = 0, e = 0] = state;
    for (let round = 0; round < ROUNDS; round += 1) {
      words[round] =
        round < 16
          ? view.getInt32(block + round * 4)
          : rotate(
              (words[round - 3] ?? 0) ^
                (words[round - 8] ?? 0) ^
                (words[round - 14] ?? 0) ^
                (words[round - 16] ?? 0),
              1,
            );
      const next =
        (rotate(a, 5) + mix(round, b, c, d) + e + (words[round] ?? 0)) | 0;
      e = d;
      d = c;
      c = rotate(b, 30);
      b = a;
      a = next;
    }
    Arr.forEach([a, b, c, d, e], (value, at) => {
      state[at] = ((state[at] ?? 0) + value) | 0;
    });
  }
  return Arr.map(state, (word) => word >>> 0);
};
