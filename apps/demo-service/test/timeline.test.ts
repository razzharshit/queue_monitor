import assert from "node:assert/strict";
import test from "node:test";
import { orderTraceByParent } from "../src/timeline.js";

test("causal ordering puts the HTTP parent before a same-timestamp queued event", () => {
  const http = { event_id: "http", parent_event_id: null, type: "http_request" };
  const queued = { event_id: "queued", parent_event_id: "http", type: "queue_job" };
  const active = { event_id: "active", parent_event_id: "queued", type: "queue_job" };

  assert.deepEqual(orderTraceByParent([queued, http, active]), [http, queued, active]);
});

test("causal ordering rejects disconnected traces", () => {
  assert.throws(
    () =>
      orderTraceByParent([
        { event_id: "http", parent_event_id: null },
        { event_id: "active", parent_event_id: "missing" },
      ]),
    /disconnected/,
  );
});
