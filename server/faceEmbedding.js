/**
 * Face recognition net descriptors (e.g. face-api.js 128-D) — cosine / L2 match server-side.
 */

const EMBEDDING_DIM = 128;

function parseEmbeddingPayload(raw) {
  if (raw == null) return null;
  let arr = raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length !== EMBEDDING_DIM) return null;
  const out = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const n = Number(arr[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

function l2Distance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * @param {string|null|undefined} storedJson
 * @param {number[]|null} candidate
 */
function matchEmbedding(storedJson, candidate) {
  const parsed = parseEmbeddingPayload(storedJson);
  if (!parsed || !candidate) {
    return { ok: false, reason: "missing", distance: null };
  }
  const dist = l2Distance(parsed, candidate);
  const thr = Number(process.env.FACE_EMBEDDING_MATCH_THRESHOLD);
  const threshold = Number.isFinite(thr) && thr > 0 && thr < 2 ? thr : 0.55;
  return { ok: dist <= threshold, distance: dist, threshold };
}

function serializeEmbedding(arr) {
  const v = parseEmbeddingPayload(arr);
  return v ? JSON.stringify(v) : null;
}

module.exports = {
  EMBEDDING_DIM,
  parseEmbeddingPayload,
  matchEmbedding,
  serializeEmbedding,
};
