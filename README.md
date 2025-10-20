## nctx — Typed AsyncLocalStorage context for Node.js

Lightweight, typed context built on Node's `AsyncLocalStorage`. Manage request-scoped state, propagate values across async boundaries, and integrate with frameworks like Express.

### Install

```bash
npm i nctx
```

Requires Node >= 18.17.

### Why nctx?

- **Typed**: Generic store with strong TypeScript types.
- **Simple**: `run`, `get`, `set`, `with`, `use`—small API that mirrors React-like ergonomics.
- **Interop**: `bind` and `bindEmitter` ensure callbacks/listeners observe the right context.
- **Express-ready**: One-line middleware to start a context per request.

### Quick start

```ts
import { createContext } from "nctx";

type Store = {
  requestId?: string;
  userId?: string;
};

export const ctx = createContext<Store>();

// Start a context scope
ctx.run({ requestId: "req-123" }, () => {
  doWork();
});

function doWork() {
  // Read values anywhere within the scope
  const rid = ctx.get("requestId");

  // Update state (shallow-merged by default)
  ctx.set({ userId: "u_42" });

  // Strongly-typed strict accessor (throws if used outside a scope)
  const store = ctx.use();
  console.log(store.requestId, store.userId);
}
```

### API

```ts
import { createContext } from "nctx";

interface ContextOptions<TStore extends object> {
  // Customize merge behavior for ctx.set / ctx.with (default: shallow assign)
  merge?: (prev: TStore, patch: Partial<TStore>) => TStore;
}

function createContext<TStore extends object>(
  options?: ContextOptions<TStore>
): {
  has(): boolean;
  get(): Readonly<TStore> | undefined;
  get<K extends keyof TStore>(key: K): TStore[K] | undefined;
  set(patch: Partial<TStore>): void;
  run<R>(initial: TStore, fn: () => R): R;
  with<R>(patch: Partial<TStore>, fn: () => R): R;
  bind<F extends (...args: any[]) => any>(fn: F, opts?: { live?: boolean }): F;
  bindEmitter(emitter: import("node:events").EventEmitter, opts?: { live?: boolean }): void;
  use(): Readonly<TStore>;
  middleware: {
    express: (opts?: {
      init?: (args: { req: any; res: any }) => TStore | Promise<TStore>;
      onStart?: (args: { req: any; res: any; store: Readonly<TStore> }) => void;
      onFinish?: (args: { req: any; res: any; store: Readonly<TStore> }) => void;
    }) => import("express").RequestHandler;
  };
};
```

- **has()**: Is there an active store?
- **get() / get(key)**: Read the full store or a single key. Returns `undefined` outside a scope.
- **set(patch)**: Shallow-merge patch into the current store. You can customize via `options.merge`.
- **run(initial, fn)**: Start a new context scope with the provided initial store.
- **with(patch, fn)**: Temporarily shadow some keys within a nested scope (uses `merge`).
- **bind(fn, opts?)**: Bind a function so it executes with the captured context.
  - Current implementation: behaves as a **live** binding by default (changes after binding are seen).
  - Pass `{ live: false }`-like behavior by cloning yourself before binding if you want snapshots.
- **bindEmitter(emitter, opts?)**: Wraps listener registration methods so listeners run inside the bound context.
  - Also **live** by default; pass `{ live: true }` explicitly for clarity.
- **use()**: Strict accessor—throws if called without an active context.
- **middleware.express(opts?)**: Create an Express middleware that starts a context per request.

### Merge behavior

By default, `set` and `with` use shallow assign:

```ts
const ctx = createContext<{ a: number; nested?: { x?: number } }>();

ctx.run({ a: 1, nested: { x: 1 } }, () => {
  ctx.set({ nested: { x: 2 } });
  // nested replaced entirely → { a: 1, nested: { x: 2 } }
});
```

Provide a custom `merge` to implement deep merge if desired:

```ts
import { createContext } from "nctx";

const ctx = createContext<{ nested: { x?: number; y?: number } }>({
  merge(prev, patch) {
    return {
      ...prev,
      nested: { ...prev.nested, ...patch.nested },
    };
  },
});
```

### Express middleware

```ts
import express from "express";
import { createContext } from "nctx";

type Store = { reqId?: string; userId?: string };
const ctx = createContext<Store>();

const app = express();

app.use(
  ctx.middleware.express({
    async init({ req }) {
      return { reqId: req.headers["x-request-id"] as string };
    },
    onStart({ store, req }) {
      req.log = (msg: string) => console.log(`[${store.reqId}]`, msg);
    },
    onFinish({ store }) {
      console.log("completed", store.reqId);
    },
  })
);

app.get("/hello", (_req, res) => {
  // Context is available during the request
  res.json({ reqId: ctx.get("reqId") });
});

app.listen(3000);
```

Notes:
- The middleware runs `init` to create an initial store per request.
- `onStart` is called inside the request context right after it begins.
- `onFinish` is attached to `finish`/`close` and runs with a bound context.

### Binding callbacks and emitters

```ts
const ctx = createContext<{ x: number }>();

let bound: () => number;
ctx.run({ x: 1 }, () => {
  const fn = () => ctx.get("x") ?? -1;
  // live by default: if ctx.set({ x: 2 }) happens later, bound sees 2
  bound = ctx.bind(fn);
});

bound(); // 1 now, 2 if updated before invocation
```

EventEmitter integration:

```ts
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
ctx.run({ x: 1 }, () => {
  ctx.bindEmitter(emitter); // live binding by default
  emitter.on("tick", () => {
    console.log(ctx.get("x"));
  });
  ctx.set({ x: 2 });
});

emitter.emit("tick"); // prints 2
```

If you want snapshot semantics, compute a snapshot store and call `ctx.bind(fn, { live: true })` on that snapshot, or copy the store before binding.

### Error handling

`ctx.use()` throws with a helpful message when called outside of a running context scope. Prefer `ctx.get()` when you want an optional access pattern.

### Testing

This repo uses Vitest. Run tests with:

```bash
npm test
```

### TypeScript config

No special configuration is required. The package ships ESM/CJS builds and type definitions.

### License

MIT


