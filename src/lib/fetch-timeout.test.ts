import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchTextWithTimeout } from "./fetch-timeout";

test("response body stalls remain subject to the Reftab deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => ({
    text: () => new Promise<string>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      started();
    }),
  }) as Response);
  const pending = fetchTextWithTimeout("https://reftab.test", {}, 30_000, "Reftab loan");
  const rejected = assert.rejects(pending, /Reftab loan timed out after 30s/);
  await reading;
  t.mock.timers.tick(30_000);
  await rejected;
});
