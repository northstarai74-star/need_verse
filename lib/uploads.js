// Accepts images sent as data URLs and checks the actual file bytes, not just the claimed type.
const crypto = require("crypto");

const SIGS = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", ext: "png", test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/webp", ext: "webp", test: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" }
];

function parseImage(dataUrl, maxBytes = 2 * 1024 * 1024) {
  const m = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return { error: "Photos must be JPEG, PNG or WebP images." };
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > maxBytes) return { error: `Each photo must be under ${Math.round(maxBytes / 1048576)} MB.` };
  const sig = SIGS.find((s) => buf.length > 12 && s.test(buf));
  if (!sig) return { error: "Photos must be JPEG, PNG or WebP images." };
  return { buf, type: sig.type, ext: sig.ext, name: crypto.randomBytes(8).toString("hex") + "." + sig.ext };
}

module.exports = { parseImage };
