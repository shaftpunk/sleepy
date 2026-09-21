import { assertEquals } from "jsr:@std/assert@1";

import {
  isAuthorizedWebhookCall,
  TEXT,
  validateSleepEventPayload,
} from "./index.ts";

Deno.test("isAuthorizedWebhookCall - rejects when no secret is configured", () => {
  assertEquals(isAuthorizedWebhookCall(undefined, "anything"), false);
  assertEquals(isAuthorizedWebhookCall(null, "anything"), false);
  assertEquals(isAuthorizedWebhookCall("", "anything"), false);
});

Deno.test("isAuthorizedWebhookCall - rejects a missing or wrong header", () => {
  assertEquals(isAuthorizedWebhookCall("s3cr3t", null), false);
  assertEquals(isAuthorizedWebhookCall("s3cr3t", "wrong"), false);
});

Deno.test("isAuthorizedWebhookCall - accepts an exact match", () => {
  assertEquals(isAuthorizedWebhookCall("s3cr3t", "s3cr3t"), true);
});

Deno.test("validateSleepEventPayload - accepts a well-formed 'started' payload", () => {
  const result = validateSleepEventPayload({
    sleep_id: "sleep-1",
    baby_id: "baby-1",
    event: "started",
    actor_user_id: "user-1",
  });

  assertEquals(result, {
    sleep_id: "sleep-1",
    baby_id: "baby-1",
    event: "started",
    actor_user_id: "user-1",
  });
});

Deno.test("validateSleepEventPayload - defaults a missing actor_user_id to null", () => {
  const result = validateSleepEventPayload({
    sleep_id: "sleep-1",
    baby_id: "baby-1",
    event: "ended",
  });

  assertEquals(result?.actor_user_id, null);
});

Deno.test("validateSleepEventPayload - rejects a missing sleep_id/baby_id", () => {
  assertEquals(
    validateSleepEventPayload({ baby_id: "baby-1", event: "started" }),
    null,
  );
  assertEquals(
    validateSleepEventPayload({ sleep_id: "sleep-1", event: "started" }),
    null,
  );
});

Deno.test("validateSleepEventPayload - rejects an unrecognized event", () => {
  const payload = JSON.parse(
    '{"sleep_id":"sleep-1","baby_id":"baby-1","event":"deleted"}',
  );

  assertEquals(validateSleepEventPayload(payload), null);
});

Deno.test("TEXT - builds the expected Norwegian title per event", () => {
  assertEquals(TEXT.started("Amalie").title, "Amalie sovnet 🌙");
  assertEquals(TEXT.ended("Amalie").title, "Amalie våknet ☀️");
});
