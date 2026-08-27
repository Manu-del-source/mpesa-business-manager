/**
 * Shared domain errors for financial state machines.
 *
 * Used by payments, payouts and refunds so every guarded transition fails
 * with the same, distinguishable error types:
 *
 *   InvalidTransitionError — the transition is forbidden by the state machine
 *                            (e.g. COMPLETED → PENDING); a programming or
 *                            integration bug, never a race.
 *   TransitionConflictError— a concurrent writer changed the state first; the
 *                            guarded conditional UPDATE matched zero rows.
 */

/** Thrown when a transition is invalid per the state machine. */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly from: string,
    public readonly to: string,
    validNext: readonly string[],
  ) {
    super(
      `Invalid ${entity} transition: ${from} → ${to}. ` +
        `Valid transitions from ${from}: ${validNext.join(", ") || "none"}.`,
    );
    this.name = "InvalidTransitionError";
  }
}

/** Thrown when a guarded transition lost a concurrency race. */
export class TransitionConflictError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
    public readonly expected: string,
  ) {
    super(
      `Concurrent ${entity} transition detected for ${id}; ` +
        `expected status ${expected} is no longer current.`,
    );
    this.name = "TransitionConflictError";
  }
}
