/**
 * Change 25 Part B — one way to call a server action from a client component and
 * be certain a failure is seen.
 *
 * The app's convention is already throw-on-server / catch-and-surface-on-client,
 * and ~20 components do that correctly. What this closes is the handful that wrote
 * `try { await action() } finally { setBusy(false) }` with no catch at all: the
 * action rejects, the promise goes unhandled, the button un-busies, and the user is
 * told nothing while believing the change saved.
 *
 * Deliberately NOT a server-side `{ ok, error }` wrapper: converting the actions to
 * return results would mean rewriting every existing call site to check `.ok`, and
 * a call site that forgets the check fails silently — strictly worse than a throw.
 */
export async function runAction(
  fn: () => Promise<unknown>,
  onError: (message: string) => void = (m) => alert(m),
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    return false;
  }
}
