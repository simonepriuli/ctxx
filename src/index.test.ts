import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createContext } from "./index";

describe("nctx", () => {
  it("has() reflects active context", () => {
    const ctx = createContext<{ a: number }>();

    expect(ctx.has()).toBe(false);

    ctx.run({ a: 1 }, () => {
      expect(ctx.has()).toBe(true);
    });

    expect(ctx.has()).toBe(false);
  });

  it("get() returns full store and by key; set() does shallow merge", () => {
    const ctx = createContext<{ a: number; b?: { x?: number; y?: number } }>();

    expect(ctx.get()).toBeUndefined();

    ctx.run({ a: 1, b: { x: 1 } }, () => {
      expect(ctx.get()).toEqual({ a: 1, b: { x: 1 } });
      expect(ctx.get("a")).toBe(1);
      expect(ctx.get("b")).toEqual({ x: 1 });

      ctx.set({ b: { y: 2 } });
      // Shallow merge: b is replaced entirely
      expect(ctx.get()).toEqual({ a: 1, b: { y: 2 } });
    });
  });

  it("with() creates a nested scope and does not leak to parent", () => {
    const ctx = createContext<{ a: number; b: number }>();

    ctx.run({ a: 1, b: 2 }, () => {
      expect(ctx.get()).toEqual({ a: 1, b: 2 });

      const result = ctx.with({ b: 3 }, () => {
        expect(ctx.get()).toEqual({ a: 1, b: 3 });
        ctx.set({ a: 10 });
        expect(ctx.get()).toEqual({ a: 10, b: 3 });
        return ctx.get("a");
      });

      expect(result).toBe(10);
      // Outer scope unchanged
      expect(ctx.get()).toEqual({ a: 1, b: 2 });
    });
  });

  it("use() throws outside of context", () => {
    const ctx = createContext<{ a: number }>();
    expect(() => ctx.use()).toThrowError(/No active context/);
  });

  it("bind() uses live store by default (current implementation)", () => {
    const ctx = createContext<{ x: number }>();

    let bound: () => number = () => -1;

    ctx.run({ x: 1 }, () => {
      const fn = () => ctx.get("x") ?? -1;
      bound = ctx.bind(fn);
      // mutate after binding
      ctx.set({ x: 2 });
      expect(ctx.get("x")).toBe(2);
    });

    // outside context, calling bound runs with latest state (x = 2)
    expect(bound()).toBe(2);
  });

  it("bind() can capture live store when opts.live = true", () => {
    const ctx = createContext<{ x: number }>();

    let boundLive: () => number = () => -1;

    ctx.run({ x: 1 }, () => {
      const fn = () => ctx.get("x") ?? -1;
      boundLive = (ctx as any).bind(fn, { live: true });
      ctx.set({ x: 3 });
      expect(ctx.get("x")).toBe(3);
    });

    // outside context, calling boundLive uses the live reference captured (x = 3)
    expect(boundLive()).toBe(3);
  });

  it("bindEmitter() ensures listeners observe context (default live & explicit live)", () => {
    const ctx = createContext<{ x: number }>();
    const emitter = new EventEmitter();

    // snapshot behavior
    ctx.run({ x: 1 }, () => {
      ctx.bindEmitter(emitter);
      let snapshotSeen: number | undefined;
      emitter.on("evt", () => {
        snapshotSeen = ctx.get("x");
      });
      // change store after binding listeners
      ctx.set({ x: 2 });
      emitter.emit("evt");
      expect(snapshotSeen).toBe(2);
    });

    // live behavior
    const emitterLive = new EventEmitter();
    ctx.run({ x: 5 }, () => {
      (ctx as any).bindEmitter(emitterLive, { live: true });
      let liveSeen: number | undefined;
      emitterLive.on("evt", () => {
        liveSeen = ctx.get("x");
      });
      ctx.set({ x: 7 });
      emitterLive.emit("evt");
      expect(liveSeen).toBe(7);
    });
  });

  it("express middleware: init, onStart and onFinish are invoked with context", async () => {
    type Store = { reqId?: string };
    const ctx = createContext<Store>();

    const calls: string[] = [];

    const req = { url: "/test" };
    const res = new EventEmitter();
    // emulate minimal Express response interface for .on("finish"|"close")
    (res as any).on = res.on.bind(res);

    const mw = ctx.middleware.express({
      init: async () => {
        calls.push("init");
        return { reqId: "abc" };
      },
      onStart: ({ store }) => {
        calls.push(`start:${store.reqId}`);
      },
      onFinish: ({ store }) => {
        calls.push(`finish:${store.reqId}`);
      },
    });

    const next = () => {
      // inside the same request context
      expect(ctx.has()).toBe(true);
      expect(ctx.get("reqId")).toBe("abc");
      // mutate store during request
      ctx.set({ reqId: "xyz" });
    };

    await mw(req as any, res as any, next);

    // Trigger response finish
    res.emit("finish");

    // onFinish observes the latest state per current live-by-default behavior
    expect(calls).toEqual(["init", "start:abc", "finish:xyz"]);
  });
});


