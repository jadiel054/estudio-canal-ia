import { createHash } from "node:crypto";

export type ImageValidationCode =
  | "invalid_image_bytes"
  | "size_exceeded"
  | "unsupported_mime"
  | "mime_mismatch"
  | "invalid_dimensions"
  | "dimension_mismatch";

export type ValidatedImage = {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sha256: string;
};

export type ImageValidationResult =
  | { ok: true; image: ValidatedImage }
  | { ok: false; code: ImageValidationCode };

const MAX_DIMENSION = 4_096;
const MAX_PIXELS = 16_777_216;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function validDimensions(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_PIXELS
  );
}

function parsePngDimensions(
  bytes: Buffer
): { width: number; height: number } | undefined {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
    return undefined;
  if (
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function parseJpegDimensions(
  bytes: Buffer
): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    return undefined;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset++];
    if (marker === 0x00) continue;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length)
      return undefined;
    const dataStart = offset + 2;
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (segmentLength < 7) return undefined;
      return {
        height: bytes.readUInt16BE(dataStart + 1),
        width: bytes.readUInt16BE(dataStart + 3),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parseWebpDimensions(
  bytes: Buffer
): { width: number; height: number } | undefined {
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    return undefined;
  const chunk = bytes.toString("ascii", 12, 16);
  const chunkLength = bytes.readUInt32LE(16);
  if (20 + chunkLength > bytes.length) return undefined;
  if (chunk === "VP8X" && chunkLength >= 10) {
    return {
      width: readUInt24LE(bytes, 24) + 1,
      height: readUInt24LE(bytes, 27) + 1,
    };
  }
  if (chunk === "VP8L" && chunkLength >= 5 && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    };
  }
  if (
    chunk === "VP8 " &&
    chunkLength >= 10 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return undefined;
}

function sniffImage(
  bytes: Buffer
):
  | { mimeType: ValidatedImage["mimeType"]; width: number; height: number }
  | undefined {
  const png = parsePngDimensions(bytes);
  if (png) return { mimeType: "image/png", ...png };
  const jpeg = parseJpegDimensions(bytes);
  if (jpeg) return { mimeType: "image/jpeg", ...jpeg };
  const webp = parseWebpDimensions(bytes);
  if (webp) return { mimeType: "image/webp", ...webp };
  return undefined;
}

export function validateImagePayload(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  expectedWidth: number;
  expectedHeight: number;
  maxBytes: number;
}): ImageValidationResult {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0)
    return { ok: false, code: "invalid_image_bytes" };
  if (
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1 ||
    input.bytes.byteLength > input.maxBytes
  ) {
    return { ok: false, code: "size_exceeded" };
  }
  if (!validDimensions(input.expectedWidth, input.expectedHeight))
    return { ok: false, code: "invalid_dimensions" };
  const declaredMimeType = input.declaredMimeType
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !declaredMimeType ||
    !["image/png", "image/jpeg", "image/webp"].includes(declaredMimeType)
  ) {
    return { ok: false, code: "unsupported_mime" };
  }
  const bytes = Buffer.from(input.bytes);
  const detected = sniffImage(bytes);
  if (!detected) return { ok: false, code: "invalid_image_bytes" };
  if (detected.mimeType !== declaredMimeType)
    return { ok: false, code: "mime_mismatch" };
  if (!validDimensions(detected.width, detected.height))
    return { ok: false, code: "invalid_dimensions" };
  if (
    detected.width !== input.expectedWidth ||
    detected.height !== input.expectedHeight
  ) {
    return { ok: false, code: "dimension_mismatch" };
  }
  return {
    ok: true,
    image: {
      bytes,
      mimeType: detected.mimeType,
      width: detected.width,
      height: detected.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
