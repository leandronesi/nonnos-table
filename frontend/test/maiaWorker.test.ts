import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../public/maia-worker.js", import.meta.url), "utf8");
function worker() {
  const messages: Array<{ type: string; status?: string; message?: string }> = [];
  const create = vi.fn(async () => ({}));
  const scope = createContext({
    self: { location: { href: "http://localhost/maia-worker.js" }, onmessage: null as unknown },
    URL, Uint8Array, ArrayBuffer, Blob, importScripts: () => {},
    ort: { env: { wasm: {} }, InferenceSession: { create } },
    postMessage: (message: typeof messages[number]) => messages.push(message),
    fetch: vi.fn(),
  });
  runInContext(source, scope);
  scope.getCachedModel = vi.fn(async () => null);
  scope.storeModel = vi.fn(async () => {});
  const send = async (data: object) => (scope.self.onmessage as (event: {data: object}) => Promise<void>)({ data });
  return { scope, messages, create, send };
}

describe("Maia model loading", () => {
  it("rejects an HTML fallback before inference or caching", async () => {
    const w = worker();
    w.scope.fetch.mockResolvedValue(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }));
    await w.send({ type: "init", modelUrl: "/missing.onnx", modelVersion: "test" });
    await w.send({ type: "download" });
    expect(w.create).not.toHaveBeenCalled();
    expect(w.scope.storeModel).not.toHaveBeenCalled();
    expect(w.messages.at(-1)?.message).toContain("returned HTML");
  });
  it("recovers an invalid cached model by requesting a new download", async () => {
    const w = worker();
    w.scope.getCachedModel.mockResolvedValue(new ArrayBuffer(8));
    w.create.mockRejectedValueOnce(new Error("invalid protobuf"));
    await w.send({ type: "init", modelUrl: "/model.onnx", modelVersion: "test" });
    expect(w.messages.at(-1)).toEqual({ type: "status", status: "no-cache" });
  });
  it("can infer with unavailable cache and only stores after a valid session", async () => {
    const w = worker();
    w.scope.getCachedModel.mockRejectedValue(new Error("private mode"));
    w.scope.storeModel.mockRejectedValue(new Error("quota"));
    w.scope.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    await w.send({ type: "init", modelUrl: "/model.onnx", modelVersion: "test" });
    expect(w.messages.at(-1)?.status).toBe("no-cache");
    await w.send({ type: "download" });
    expect(w.create).toHaveBeenCalledTimes(1);
    expect(w.create.mock.invocationCallOrder[0]).toBeLessThan(w.scope.storeModel.mock.invocationCallOrder[0]);
    expect(w.messages.at(-1)?.status).toBe("ready");
  });
});
