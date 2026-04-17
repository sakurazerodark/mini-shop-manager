const fetchJsonWithTimeout = async (url, options = {}, timeoutMs = 4500) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_) {
        json = null;
      }
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
};

module.exports = { fetchJsonWithTimeout };
