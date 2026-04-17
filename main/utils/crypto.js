const crypto = require('crypto');

const normalizePem = (pem) => {
  if (!pem) return '';
  let s = String(pem).trim();
  if (s.includes('\\n') && !s.includes('\n')) {
    s = s.replace(/\\n/g, '\n');
  }
  return s;
};

const toPemLines = (b64) => {
  const s = String(b64 || '').replace(/\s+/g, '');
  return s.match(/.{1,64}/g)?.join('\n') || s;
};

const buildPem = (b64, type) => {
  return `-----BEGIN ${type}-----\n${toPemLines(b64)}\n-----END ${type}-----\n`;
};

const createPrivateKeyFromInput = (input) => {
  const raw = normalizePem(input);
  if (!raw) throw new Error('私钥为空');
  if (raw.includes('-----BEGIN')) {
    return crypto.createPrivateKey({ key: raw });
  }
  const b64 = raw.replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');
  if (!der.length) throw new Error('私钥内容无效');

  try {
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch (_) {}
  try {
    return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs1' });
  } catch (_) {}
  try {
    return crypto.createPrivateKey({ key: buildPem(b64, 'PRIVATE KEY') });
  } catch (_) {}
  return crypto.createPrivateKey({ key: buildPem(b64, 'RSA PRIVATE KEY') });
};

const createPublicKeyFromInput = (input) => {
  const raw = normalizePem(input);
  if (!raw) throw new Error('公钥为空');
  if (raw.includes('-----BEGIN')) {
    return crypto.createPublicKey({ key: raw });
  }
  const b64 = raw.replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');
  if (!der.length) throw new Error('公钥内容无效');
  try {
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (_) {}
  try {
    return crypto.createPublicKey({ key: buildPem(b64, 'PUBLIC KEY') });
  } catch (_) {}
  return crypto.createPublicKey({ key: buildPem(b64, 'RSA PUBLIC KEY') });
};

const alipayEncryptBizContent = (plainText, encryptKeyBase64) => {
  const key = Buffer.from(String(encryptKeyBase64 || '').trim(), 'base64');
  if (key.length !== 16) {
    throw new Error('支付宝AES密钥格式不正确：应为 base64 编码的 16 字节密钥（AES-128）');
  }
  const iv = Buffer.alloc(16, 0);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
};

const alipayDecryptBizContent = (cipherTextBase64, encryptKeyBase64) => {
  const key = Buffer.from(String(encryptKeyBase64 || '').trim(), 'base64');
  if (key.length !== 16) {
    throw new Error('支付宝AES密钥格式不正确：应为 base64 编码的 16 字节密钥（AES-128）');
  }
  const iv = Buffer.alloc(16, 0);
  const data = Buffer.from(String(cipherTextBase64 || '').trim(), 'base64');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
};

const alipaySign = (params, privateKeyPem) => {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const signingString = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingString, 'utf8');
  try {
    const keyObject = createPrivateKeyFromInput(privateKeyPem);
    return sign.sign({ key: keyObject, padding: crypto.constants.RSA_PKCS1_PADDING }, 'base64');
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    throw new Error(`支付宝私钥解析失败：${msg}。支持两种格式：1）带-----BEGIN/END-----的PEM；2）仅粘贴base64私钥内容（不含头尾）。私钥必须为RSA2且非密码保护。`);
  }
};

const alipayVerifySign = (form, alipayPublicKeyInput) => {
  const params = { ...(form || {}) };
  const signature = String(params.sign || '').trim().replace(/\s+/g, '+');
  delete params.sign;
  delete params.sign_type;
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const signingString = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(signingString, 'utf8');
  const pubKey = createPublicKeyFromInput(alipayPublicKeyInput);
  return verify.verify(pubKey, Buffer.from(signature, 'base64'));
};

const wechatpayVerifySignature = (headers, rawBody, platformCertPem) => {
  const timestamp = String(headers['wechatpay-timestamp'] || headers['Wechatpay-Timestamp'] || '').trim();
  const nonce = String(headers['wechatpay-nonce'] || headers['Wechatpay-Nonce'] || '').trim();
  const signature = String(headers['wechatpay-signature'] || headers['Wechatpay-Signature'] || '').trim();
  if (!timestamp || !nonce || !signature) return false;
  const message = `${timestamp}\n${nonce}\n${rawBody || ''}\n`;
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(message, 'utf8');
  const pub = crypto.createPublicKey(platformCertPem);
  return verify.verify(pub, Buffer.from(signature, 'base64'));
};

const wechatpayDecryptResource = (resource, apiV3Key) => {
  const key = Buffer.from(String(apiV3Key || ''), 'utf8');
  if (key.length !== 32) throw new Error('微信APIv3Key长度不正确：应为32字节');
  const associatedData = String(resource?.associated_data || '');
  const nonce = String(resource?.nonce || '');
  const cipherTextB64 = String(resource?.ciphertext || '');
  const data = Buffer.from(cipherTextB64, 'base64');
  const cipherText = data.subarray(0, data.length - 16);
  const authTag = data.subarray(data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
};

const unionpayVerifySignature = (form, verifyCertInput) => {
  const params = { ...(form || {}) };
  const signature = String(params.signature || '').trim().replace(/\s+/g, '+');
  delete params.signature;
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const signingString = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(signingString, 'utf8');
  const pub = createPublicKeyFromInput(verifyCertInput);
  return verify.verify(pub, Buffer.from(signature, 'base64'));
};

module.exports = {
  createPrivateKeyFromInput,
  createPublicKeyFromInput,
  alipayEncryptBizContent,
  alipayDecryptBizContent,
  alipaySign,
  alipayVerifySign,
  wechatpayVerifySignature,
  wechatpayDecryptResource,
  unionpayVerifySignature
};
