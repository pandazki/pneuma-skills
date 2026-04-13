import { useMemo, useSyncExternalStore, useRef } from "react";
import type { Source, SourceEvent } from "../../core/types/source.js";

export interface SourceStatus {
  /** Origin of the most recently delivered value event, or null. */
  lastOrigin: "initial" | "self" | "external" | null;
  /** Most recent error event, or null. Cleared on the next successful value. */
  lastError: { code: string; message: string } | null;
}

export interface UseSourceResult<T> {
  /** Latest value, or null before the initial event. */
  value: T | null;
  /** Bound write method — identical semantics to source.write(). */
  write: (value: T) => Promise<void>;
  /** Observability state. */
  status: SourceStatus;
}

/**
 * React binding for Source<T>.
 *
 * Uses useSyncExternalStore so React's concurrent rendering and
 * StrictMode double-invocation behave correctly — the subscription
 * is re-attached cleanly on remount without causing the source to
 * re-emit.
 *
 * The returned { value, write, status } is a stable shape. `value`
 * changes when new events arrive; `write` is a bound reference that
 * does not change identity across renders (so downstream effects
 * depending on [write] don't re-run gratuitously).
 *
 * ## Handling undefined source
 *
 * Accepts `Source<T> | null | undefined` because `useSourceInstances`
 * in App.tsx populates the source map asynchronously (first render
 * returns an empty `sources: {}` while the useEffect runs). During
 * that one-render window, `sources.myKey` is undefined, and every
 * migrated viewer would otherwise crash on `source.current()`.
 *
 * When source is null/undefined, this hook:
 *   - returns `value: null` (viewer's existing "no initial value yet"
 *     fallback handles it — e.g. `if (!deck) return <EmptyState />`)
 *   - returns a no-op `write` that resolves without doing anything
 *   - leaves `status` at its default {lastOrigin: null, lastError: null}
 *
 * Once the source map populates (second render), the hook re-subscribes
 * cleanly — useSyncExternalStore's subscribe function dep-array picks
 * up the source reference change.
 */
export function useSource<T>(
  source: Source<T> | null | undefined,
): UseSourceResult<T> {
  // A mutable status ref so status updates don't cause a re-render
  // on their own — status is a secondary observation surface, the
  // primary re-render driver is `value`.
  const statusRef = useRef<SourceStatus>({
    lastOrigin: null,
    lastError: null,
  });

  // useSyncExternalStore needs a stable subscribe function per source.
  // When source is missing, subscribe is a no-op that returns a no-op
  // unsubscribe.
  const subscribe = useMemo(() => {
    if (!source) {
      return (_notify: () => void) => () => {};
    }
    return (notify: () => void) => {
      const off = source.subscribe((event: SourceEvent<T>) => {
        if (event.kind === "value") {
          statusRef.current = {
            lastOrigin: event.origin,
            lastError: null,
          };
        } else if (event.kind === "error") {
          statusRef.current = {
            ...statusRef.current,
            lastError: { code: event.code, message: event.message },
          };
        }
        notify();
      });
      return off;
    };
  }, [source]);

  // getSnapshot must be stable per source. When source is missing,
  // always return null so useSyncExternalStore sees a stable value.
  const getSnapshot = useMemo(() => {
    if (!source) return () => null;
    return () => source.current();
  }, [source]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // write() binds to the real source, or is a silent no-op when
  // source is missing. The no-op resolves rather than rejects so
  // viewer code that `await`s write doesn't need a try/catch just
  // for the initial-render gap.
  const write = useMemo<(value: T) => Promise<void>>(() => {
    if (!source) {
      return async () => {
        // no-op during the first-render source-population gap
      };
    }
    return source.write.bind(source);
  }, [source]);

  return {
    value,
    write,
    status: statusRef.current,
  };
}
