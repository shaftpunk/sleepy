import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { liveActivityEndRequest } from "../_shared/apns.ts";
import { endLiveActivities } from "./liveActivities.ts";

Deno.test("ActivityKit end uses the correct topic, environment and decoder fields", () => {
  assertEquals(liveActivityEndRequest("sandbox", 100), {
    host: "api.sandbox.push.apple.com", topic: "no.strandeconsulting.sleepy.push-type.liveactivity",
    pushType: "liveactivity", payload: { aps: { timestamp: 100, event: "end",
      "content-state": { soundMonitoringActive: false }, "dismissal-date": 99 } },
  });
  assertEquals(liveActivityEndRequest("production", 100).host, "api.push.apple.com");
});

Deno.test("ActivityKit dispatch cleans only matching revisions, retries once, and tolerates duplicates", async () => {
  let rows = ["accepted", "invalid", "rotate", "retry"].map((activity_id, i) => ({
    activity_id, installation_id: String(i), revision: 1, environment: "production", push_token: activity_id,
  }));
  const sent: string[] = [];
  const db = {
    rpc(name: string, args: unknown) {
      assertEquals(name, "live_activity_end_targets");
      assertEquals(args, { p_sleep_id: "sleep", p_baby_id: "baby", p_endtime: "ended" });
      return { data: [...rows] };
    },
    from() {
      return { update(value: unknown) {
        assertEquals(value, { push_token: null });
        const filters = new Map();
        const query = { eq(key: string, value: unknown) {
          filters.set(key, value);
          if (key === "revision") {
            rows = rows.filter(row => row.installation_id !== filters.get("installation_id") ||
              row.activity_id !== filters.get("activity_id") || row.revision !== value);
            return { error: null };
          }
          return query;
        } };
        return query;
      } };
    },
  } as unknown as SupabaseClient;
  async function send(token: string) {
    sent.push(token);
    if (token === "invalid") return { status: 400, reason: "BadDeviceToken" };
    if (token === "rotate") {
      rows = rows.map(row => row.activity_id === "rotate" ? { ...row, revision: 2, push_token: "rotated" } : row);
    }
    if (token === "retry" && sent.filter(value => value === token).length === 1) return { status: 503 };
    return { status: 200 };
  }
  const dispatch = () => endLiveActivities(db, "sleep", "baby", "ended", send, () => Promise.resolve());
  await dispatch();
  assertEquals(sent, ["accepted", "invalid", "rotate", "retry", "retry"]);
  assertEquals(rows.map(row => row.push_token), ["rotated"]);
  await dispatch();
  await dispatch();
  assertEquals(sent, ["accepted", "invalid", "rotate", "retry", "retry", "rotated"]);
});

Deno.test("ActivityKit retry skips delivery after the sleep reopens", async () => {
  let ended = true;
  let sends = 0;
  const db = { rpc: () => ({ data: ended ? [{
    activity_id: "card", installation_id: "phone", revision: 1, environment: "production", push_token: "token",
  }] : [] }) } as unknown as SupabaseClient;
  await endLiveActivities(db, "sleep", "baby", "ended", () => {
    sends++;
    return Promise.resolve({ status: 503 });
  }, () => {
    ended = false;
    return Promise.resolve();
  });
  assertEquals(sends, 1);
});
