import { crc32, deflateSync } from "node:zlib";

/** A small striped PNG, enough to stand in for a live-view frame or a screenshot. */
export function stripedPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0; // filter: none
    const shade = Math.floor(y / 16) % 2 === 0 ? 1 : 0.85;
    for (let x = 0; x < width; x++) {
      const o = y * row + 1 + x * 3;
      raw[o] = Math.round(rgb[0] * shade);
      raw[o + 1] = Math.round(rgb[1] * shade);
      raw[o + 2] = Math.round(rgb[2] * shade);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
