## ctxx — Typed AsyncLocalStorage context for Node.js

Lightweight, typed context built on Node's `AsyncLocalStorage`. Manage request-scoped state, propagate values across async boundaries, and integrate with frameworks like Express.

### Install

```bash
npm i ctxx
```

Requires Node >= 18.17.

### Why ctxx?

- **Typed**: Generic store with strong TypeScript types.
- **Simple**: `run`, `get`, `set`, `with`, `use`—small API that mirrors React-like ergonomics.
- **Interop**: `bind` and `bindEmitter` ensure callbacks/listeners observe the right context.
- **Express-ready**: One-line middleware to start a context per request.

### Quick start

```ts
import { createContext } from "ctxx";

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

#### Create a context

```ts
import { createContext } from "ctxx";

type Store = Record<string, unknown>;

const ctx = createContext<Store>({
  // optional: customize merge behavior for set()/with() (default is shallow assign)
  merge(prev, patch) {
    return Object.assign({}, prev, patch);
  },
});
```

#### At a glance

| Method | Signature | Returns | Notes |
| --- | --- | --- | --- |
| `has` | `has()` | `boolean` | Is there an active store? |
| `get` | `get()` / `get(key)` | `store | value | undefined` | Optional accessor; safe outside a scope |
| `set` | `set(patch)` | `void` | Shallow-merge by default (customizable via `merge`) |
| `run` | `run(initial, fn)` | `R` | Start a new async context scope |
| `with` | `with(patch, fn)` | `R` | Nested scope with merged store |
| `bind` | `bind(fn, opts?)` | `F` | Run `fn` with the bound context; **live by default** |
| `bindEmitter` | `bindEmitter(emitter, opts?)` | `void` | Listener methods run with bound context; **live by default** |
| `use` | `use()` | `store` | Strict accessor; throws outside a scope |
| `middleware.express` | `express(opts?)` | `RequestHandler` | Starts a scope per request |

#### Method snippets

```ts
// has / get / set
if (!ctx.has()) {
  ctx.run({ a: 1 }, () => {/* ... */});
}

ctx.run({ a: 1, nested: { x: 1 } }, () => {
  ctx.get();         // { a: 1, nested: { x: 1 } }
  ctx.get("a");      // 1
  ctx.set({ a: 2 }); // { a: 2, nested: { x: 1 } }
});

// with (temporary shadow)
ctx.run({ a: 1, b: 2 }, () => {
  ctx.with({ b: 3 }, () => {
    ctx.get("b"); // 3
  });
  ctx.get("b");   // 2
});

// use (strict)
ctx.run({ a: 1 }, () => {
  const store = ctx.use();
  store.a; // 1
});

// bind (callbacks)
let bound: () => number;
ctx.run({ x: 1 }, () => {
  bound = ctx.bind(() => ctx.get("x") ?? -1); // live by default
  ctx.set({ x: 2 });
});
bound(); // 2

// bindEmitter (EventEmitter)
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
ctx.run({ x: 1 }, () => {
  ctx.bindEmitter(emitter); // live by default
  emitter.on("tick", () => {
    console.log(ctx.get("x")); // 2
  });
  ctx.set({ x: 2 });
});
```

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
import { createContext } from "ctxx";

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
import { createContext } from "ctxx";

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


