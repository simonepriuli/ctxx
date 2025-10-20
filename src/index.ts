import { AsyncLocalStorage } from "node:async_hooks";
import type { EventEmitter } from "node:events";

type ReadonlyDeep<T> = {
  readonly [K in keyof T]: T[K] extends Record<string, unknown>
    ? ReadonlyDeep<T[K]>
    : T[K];
};

export interface ContextOptions<TStore extends object> {
  /**
   * Merge strategy for ctx.set / ctx.with (default: shallow assign).
   */
  merge?: (prev: TStore, patch: Partial<TStore>) => TStore;
}

export interface Context<TStore extends object> {
  /** Is there an active store? */
  has(): boolean;

  /** Read the store or a single key. */
  get(): ReadonlyDeep<TStore> | undefined;
  get<K extends keyof TStore>(key: K): TStore[K] | undefined;

  /** Like React setState (shallow by default). */
  set(patch: Partial<TStore>): void;

  /** Run a function in a new context scope with an initial store. */
  run<R>(initial: TStore, fn: () => R): R;

  /**
   * Temporarily shadow some keys during fn.
   * Implemented by nesting a new ALS scope with merged store.
   */
  with<R>(patch: Partial<TStore>, fn: () => R): R;

  /** Bind a function to the current store; returns a wrapped function. */
  bind<F extends (...args: any[]) => any>(fn: F): F;

  /** Bind an EventEmitter so emitted listeners see the right context. */
  bindEmitter(emitter: EventEmitter): void;

  /** Strict accessor: throws if used without active context. */
  use(): ReadonlyDeep<TStore>;

  /** Express middleware helper (starts a context per request). */
  middleware: {
    express: (opts?: {
      /** Build the initial store from the req/res. */
      init?: (args: { req: any; res: any }) => TStore | Promise<TStore>;
      /** Hook after context has started (e.g., attach logger to req). */
      onStart?: (args: {
        req: any;
        res: any;
        store: ReadonlyDeep<TStore>;
      }) => void;
      /** Hook before response finishes. */
      onFinish?: (args: {
        req: any;
        res: any;
        store: ReadonlyDeep<TStore>;
      }) => void;
    }) => import("express").RequestHandler;
  };
}

function defaultMerge<T extends object>(prev: T, patch: Partial<T>): T {
  return Object.assign({}, prev, patch);
}

export function createContext<TStore extends object>(
  options?: ContextOptions<TStore>
): Context<TStore> {
  const als = new AsyncLocalStorage<TStore>();
  const merge = options?.merge ?? defaultMerge<TStore>;

  function getStore(): TStore | undefined {
    return als.getStore();
  }

  // Overloads
  function get(): ReadonlyDeep<TStore> | undefined;
  function get<K extends keyof TStore>(key: K): TStore[K] | undefined;

  // Implementation — note the union return type covering both overloads
  function get<K extends keyof TStore>(
    key?: K
  ): ReadonlyDeep<TStore> | TStore[K] | undefined {
    const store = getStore();
    if (!store) return undefined;

    if (key !== undefined) {
      // index access when key is provided
      return store[key];
    }
    // whole-store path; cast to the readonly view you promise in the overload
    return store as ReadonlyDeep<TStore>;
  }

  function set(patch: Partial<TStore>): void {
    const store = getStore();
    if (!store) return; // silently ignore if outside context
    const next = merge(store, patch);
    // We want mutation to be visible in current tick & future awaits.
    // ALS stores are by reference; we replace properties in place:
    for (const k of Object.keys(store) as (keyof TStore)[]) {
      delete (store as any)[k];
    }
    Object.assign(store as any, next);
  }

  function run<R>(initial: TStore, fn: () => R): R {
    return als.run(structuredClone(initial), fn);
  }

  function withScope<R>(patch: Partial<TStore>, fn: () => R): R {
    const current = getStore();
    const next = merge(current ?? ({} as TStore), patch as TStore);
    return als.run(structuredClone(next), fn);
  }

  /** Bind a function to the *current* ALS store (snapshot by default). */
  function bind<F extends (...args: any[]) => any>(
    fn: F,
    opts?: { live?: boolean }
  ): F {
    const captured = als.getStore();
    if (captured === undefined) return fn; // no active context; nothing to bind

    // If you prefer a *snapshot* (default), clone; for a *live* view, reuse the same ref.
    const getBoundStore = () =>
      opts?.live ? captured : (structuredClone(captured) as TStore);

    const wrapped = ((...args: any[]) =>
      als.run(getBoundStore(), () => fn(...args))) as F;

    return wrapped;
  }

  /** Bind an EventEmitter so listeners see the captured context when invoked. */
  function bindEmitter(emitter: EventEmitter, opts?: { live?: boolean }) {
    const prebind = <T extends Function>(fn: T): T =>
      bind(fn as any, opts) as any;

    // keep original methods
    const add = emitter.addListener.bind(emitter);
    const on = emitter.on.bind(emitter);
    const once = emitter.once.bind(emitter);
    const prepend = (emitter as any).prependListener?.bind(emitter);
    const prependOnce = (emitter as any).prependOnceListener?.bind(emitter);

    emitter.addListener = ((evt: any, listener: any) =>
      add(evt, prebind(listener))) as any;
    emitter.on = ((evt: any, listener: any) =>
      on(evt, prebind(listener))) as any;
    emitter.once = ((evt: any, listener: any) =>
      once(evt, prebind(listener))) as any;

    if (prepend) {
      (emitter as any).prependListener = ((evt: any, listener: any) =>
        prepend(evt, prebind(listener))) as any;
    }
    if (prependOnce) {
      (emitter as any).prependOnceListener = ((evt: any, listener: any) =>
        prependOnce(evt, prebind(listener))) as any;
    }
  }

  function use(): ReadonlyDeep<TStore> {
    const store = getStore();
    if (!store) {
      throw new Error(
        "No active context. Make sure to wrap your code with ctx.run(...) or use the provided middleware."
      );
    }
    return store;
  }

  // Express middleware helper
  const middleware = {
    express:
      (opts?: {
        init?: (args: { req: any; res: any }) => TStore | Promise<TStore>;
        onStart?: (args: {
          req: any;
          res: any;
          store: ReadonlyDeep<TStore>;
        }) => void;
        onFinish?: (args: {
          req: any;
          res: any;
          store: ReadonlyDeep<TStore>;
        }) => void;
      }) =>
      async (req: any, res: any, next: any) => {
        const initial = (await opts?.init?.({ req, res })) ?? ({} as TStore);

        run(initial, () => {
          opts?.onStart?.({ req, res, store: use() });

          // Ensure we still have context in finish callbacks:
          const finish = bind(() => {
            try {
              opts?.onFinish?.({ req, res, store: use() });
            } catch {
              /* no-op */
            }
          });

          res.on("finish", finish);
          res.on("close", finish);

          next();
        });
      },
  };

  return {
    has: () => getStore() !== undefined,
    get: get as any,
    set,
    run,
    with: withScope,
    bind,
    bindEmitter,
    use,
    middleware,
  };
}
