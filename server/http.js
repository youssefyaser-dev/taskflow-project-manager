export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const ROLE_RANK = { viewer: 1, member: 2, admin: 3, owner: 4 };

export function validators() {
  const str = (v, field, { max = 200, required = true } = {}) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (required && !s) throw new HttpError(400, `${field} is required`);
    if (s.length > max) throw new HttpError(400, `${field} is too long`);
    return s;
  };
  const date = (v, field) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} is invalid`);
    return v;
  };
  const oneOf = (v, list, field) => {
    if (!list.includes(v)) throw new HttpError(400, `${field} is invalid`);
    return v;
  };
  const int = (v, field, { min = 0, max = 1e9 } = {}) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} is invalid`);
    return n;
  };
  return { str, date, oneOf, int };
}

// Fixed-window in-memory limiter, keyed by caller. Good enough for a single process.
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) { hits.set(key, { start: now, n: 1 }); return next(); }
    rec.n += 1;
    if (rec.n > max) return next(new HttpError(429, 'too many attempts, try again later'));
    next();
  };
}
