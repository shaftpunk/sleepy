// Native push can register a synchronous invalidation plus an authenticated detach.
// Its registration callbacks must capture the generation and check it before saving.
let generation = 0;
const cleanup = new Set<() => Promise<void>>();

export const sessionGeneration = () => generation;
export const isSessionGenerationCurrent = (value: number) => value === generation;
export function invalidateSessionWork() { generation++; }
export function registerBeforeSignOut(handler: () => Promise<void>): () => void {
  cleanup.add(handler);
  return () => { cleanup.delete(handler); };
}
export async function prepareSignOut(): Promise<void> {
  invalidateSessionWork();
  // Fail before signOut if authenticated device-token removal fails; allow retry.
  await Promise.all(Array.from(cleanup, (handler) => handler()));
}
