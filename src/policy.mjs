import { validateContext } from './context.mjs';

const signature = e => JSON.stringify([e.check_id, e.outcome, e.category ?? null, e.resolves ?? null]);
const unknown = reason => ({ managed: false, effort: null, reason, unknown: true, replay: false });

export class Policy {
  constructor({ maxRuns = 256, maxCalls = 256, maxEvents = 256 } = {}) {
    this.runs = new Map();
    this.limits = { maxRuns, maxCalls, maxEvents };
  }

  decide(context, fingerprint) {
    try { validateContext(context); } catch { return unknown('invalid_context'); }
    const { run_id, call_id, seq, observations } = context;
    const prior = this.runs.get(run_id);
    const cached = prior?.calls.get(call_id);
    if (cached) {
      return cached.fingerprint === fingerprint && cached.seq === seq
        ? { ...cached.decision, replay: true }
        : unknown('call_conflict');
    }
    if (seq !== (prior?.seq ?? 0) + 1) return unknown('sequence_gap');
    if ((!prior && this.runs.size >= this.limits.maxRuns) ||
        (prior && prior.calls.size >= this.limits.maxCalls)) return unknown('capacity');

    // Validate the entire batch before changing any state.
    const events = new Map(prior?.events);
    const added = [];
    for (const event of observations) {
      const sig = signature(event);
      if (events.has(event.id)) {
        if (events.get(event.id) !== sig) return unknown('event_conflict');
      } else {
        events.set(event.id, sig);
        added.push(event);
      }
    }
    if (events.size > this.limits.maxEvents) return unknown('capacity');
    const pending = new Map(prior?.pending);
    let resolved = false;
    let failed = false;
    let uncertain = false;
    let external = false;
    for (const event of added) {
      if (event.outcome === 'success' && event.resolves) {
        // Only a previously outstanding failure is a causal recheck target.
        if (prior?.pending.get(event.resolves) === event.check_id) {
          pending.delete(event.resolves);
          resolved = true;
        } else uncertain = true;
      }
      if (event.outcome === 'failure') {
        if (event.category === 'reasoning') {
          pending.set(event.id, event.check_id);
          failed = true;
        } else if (event.category === 'unknown') uncertain = true;
        else external = true;
      }
      if (event.outcome === 'unknown') uncertain = true;
    }
    const decision = {
      managed: true,
      effort: pending.size ? 'high' : 'low',
      reason: failed ? 'reasoning_failure' : pending.size ? 'unresolved_failure' :
        resolved ? 'recheck_succeeded' : uncertain ? 'unknown_observation' :
          external ? 'external_failure' : prior ? 'no_new_evidence' : 'initial_low',
      unknown: uncertain || observations.length === 0,
      external_failure: external,
      pending: pending.size,
      replay: false,
    };
    const calls = prior?.calls ?? new Map();
    calls.set(call_id, { seq, fingerprint, decision });
    this.runs.set(run_id, { seq, events, pending, calls });
    return { ...decision };
  }
}
