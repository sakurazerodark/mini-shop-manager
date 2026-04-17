const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { baseDataDir } = require('./dir');

const uploadsDir = path.join(baseDataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const saveBase64Image = async ({ base64, mime }) => {
  if (!base64) return null;
  let raw = String(base64);
  let detectedMime = mime;
  const m = raw.match(/^data:(.+?);base64,(.*)$/);
  if (m) {
    detectedMime = detectedMime || m[1];
    raw = m[2];
  }
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) return null;

  const extMap = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = extMap[String(detectedMime || '').toLowerCase()] || 'png';
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const absPath = path.join(uploadsDir, fileName);
  await fs.promises.writeFile(absPath, buffer);
  return `/uploads/${fileName}`;
};

module.exports = {
  saveBase64Image,
  uploadsDir
};
