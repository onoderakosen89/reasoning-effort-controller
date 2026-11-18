import { createHash } from 'node:crypto';
import { decodeContext } from './context.mjs';

// JSON.parse validates syntax, but we never stringify the user's object.
// Scanning value spans preserves unknown fields, exact numbers and whitespace.
function scan(text) {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i++] === '"') return { start, end: i };
    }
    throw new Error('invalid_json');
  };
  function value(depth = 0) {
    if (depth > 128) throw new Error('json_depth');
    ws();
    const start = i;
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; ws();
      const entries = new Map();
      if (text[i] !== '}') {
        while (true) {
          ws();
          const keySpan = string();
          const key = JSON.parse(text.slice(keySpan.start, keySpan.end));
          if (entries.has(key)) throw new Error('duplicate_key');
          ws(); i++; // colon (syntax was validated)
          entries.set(key, value(depth + 1));
          ws();
          if (text[i] !== ',') break;
          i++;
        }
      }
      i++;
      return { start, end: i, entries };
    }
    if (text[i] === '[') {
      i++; ws();
      if (text[i] !== ']') {
        while (true) {
          value(depth + 1); ws();
          if (text[i] !== ',') break;
          i++;
        }
      }
      i++;
      return { start, end: i };
    }
    while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
    return { start, end: i };
  }
  return value();
}

export function prepareBody(body, path, model) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  const data = JSON.parse(text);
  if (!data || Array.isArray(data) || data.model !== model) throw new Error('non_target_model');
  const root = scan(text);
  let object = root;
  let key = 'reasoning_effort';
  if (path === '/v1/responses') {
    key = 'effort';
    if (root.entries.has('reasoning')) {
      object = root.entries.get('reasoning');
      if (!object.entries) throw new Error('invalid_reasoning');
    } else {
      return effort => Buffer.from(insert(root, 'reasoning', `{"effort":${JSON.stringify(effort)}}`));
    }
  }
  function insert(target, field, rawValue) {
    const at = target.end - 1;
    const addition = `${target.entries.size ? ',' : ''}${JSON.stringify(field)}:${rawValue}`;
    return text.slice(0, at) + addition + text.slice(at);
  }
  return effort => {
    const old = object.entries.get(key);
    if (!old) return Buffer.from(insert(object, key, JSON.stringify(effort)));
    if (JSON.parse(text.slice(old.start, old.end)) === effort) return body;
    return Buffer.from(text.slice(0, old.start) + JSON.stringify(effort) + text.slice(old.end));
  };
}

export function routeBody({ body, path, model, encodedContext, policy }) {
  let render;
  let context;
  try { render = prepareBody(body, path, model); }
  catch (error) {
    const known = ['non_target_model', 'duplicate_key', 'invalid_reasoning', 'json_depth'];
    return { body, decision: { managed: false, effort: null, unknown: true,
      reason: known.includes(error.message) ? error.message : 'invalid_json' } };
  }
  try { context = decodeContext(encodedContext); }
  catch { return { body, decision: { managed: false, effort: null, unknown: true, reason: 'invalid_context' } }; }
  const fingerprint = createHash('sha256').update(body).update('\0').update(encodedContext).digest('hex');
  const decision = policy.decide(context, fingerprint);
  return { body: decision.managed ? render(decision.effort) : body, decision, context };
}
