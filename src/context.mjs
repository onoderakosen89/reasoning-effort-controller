// This is a caller contract, not a parser for model/tool prose.
export const CONTEXT_HEADER = 'x-effort-context';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const CATEGORIES = new Set(['reasoning', 'approval', 'permission', 'quota', 'transport', 'unknown']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, keys) => Object.keys(value).every(key => keys.includes(key));

export function validateContext(value) {
  if (!object(value) || !keysOnly(value, ['v', 'run_id', 'call_id', 'seq', 'observations']) ||
      value.v !== 1 || !ID.test(value.run_id ?? '') || !ID.test(value.call_id ?? '') ||
      typeof value.run_id !== 'string' || typeof value.call_id !== 'string' ||
      !Number.isSafeInteger(value.seq) || value.seq < 1 ||
      !Array.isArray(value.observations) || value.observations.length > 64) {
    throw new Error('invalid_context');
  }
  for (const event of value.observations) {
    if (!object(event) || !keysOnly(event, ['id', 'check_id', 'outcome', 'category', 'resolves']) ||
        typeof event.id !== 'string' || !ID.test(event.id) ||
        typeof event.check_id !== 'string' || !ID.test(event.check_id) ||
        !['failure', 'success', 'unknown'].includes(event.outcome)) throw new Error('invalid_observation');
    if (event.outcome === 'failure') {
      if (!CATEGORIES.has(event.category) || event.resolves !== undefined) throw new Error('invalid_observation');
    } else if (event.category !== undefined ||
        (event.resolves !== undefined && (event.outcome !== 'success' ||
          typeof event.resolves !== 'string' || !ID.test(event.resolves)))) {
      throw new Error('invalid_observation');
    }
  }
  return value;
}

export function encodeContext(value) {
  validateContext(value);
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  if (encoded.length > 8192) throw new Error('context_too_large');
  return encoded;
}

export function decodeContext(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('invalid_context');
  }
  const raw = Buffer.from(encoded, 'base64url');
  if (raw.toString('base64url') !== encoded) throw new Error('invalid_context');
  return validateContext(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
}
