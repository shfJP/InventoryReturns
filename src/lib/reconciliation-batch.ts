/** Execute writes in order. A failed or uncertain write stops the batch without retries. */
export async function runReconciliationBatch<T>(
  targets: readonly T[],
  perform: (target: T) => Promise<void>,
  onSuccess: (target: T) => void,
  onFailure: (target: T, error: unknown) => void,
) {
  let completed = 0;
  for (const target of targets) {
    try {
      await perform(target);
    } catch (error) {
      onFailure(target, error);
      return { completed, stopped: true };
    }
    completed++;
    onSuccess(target);
  }
  return { completed, stopped: false };
}
