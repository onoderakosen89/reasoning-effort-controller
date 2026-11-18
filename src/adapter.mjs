import { randomUUID } from 'node:crypto';
import { CONTEXT_HEADER, encodeContext } from './context.mjs';

// The caller defines the boundary of each logical API call.
export class RunContext {
  constructor(runId = randomUUID()) {
    this.runId = runId;
    this.seq = 0;
  }

  next(observations = []) {
    const encoded = encodeContext({ v: 1, run_id: this.runId, call_id: randomUUID(),
      seq: this.seq + 1, observations });
    this.seq++;
    // Reuse this exact object on HTTP retry. Do not call next() again.
    return Object.freeze({ [CONTEXT_HEADER]: encoded });
  }
}
