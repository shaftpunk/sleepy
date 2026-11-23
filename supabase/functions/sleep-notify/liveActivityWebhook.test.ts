import { assertEquals } from "jsr:@std/assert@1";
import handler from "./index.ts";
import webpush from "npm:web-push@3.6.7";

Deno.test("sleep-notify attempts ActivityKit delivery before VAPID and independently of alert preferences", async () => {
  const keys = webpush.generateVAPIDKeys();
  const env: Record<string, string | undefined> = {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SLEEP_EVENT_WEBHOOK_SECRET: "test-secret",
    APNS_PRIVATE_KEY: "configured",
    VAPID_PUBLIC_KEY: undefined,
    VAPID_PRIVATE_KEY: undefined,
  };
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, Deno.env.get(key)]));
  const setEnv = (key: string, value: string | undefined) => value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    for (const [key, value] of Object.entries(env)) setEnv(key, value);
    globalThis.fetch = (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      switch (path) {
        case "/rest/v1/sleep": return Promise.resolve(Response.json({ id: "sleep", baby_id: "baby", endtime: "ended" }));
        case "/rest/v1/rpc/live_activity_end_targets": return Promise.resolve(Response.json({ message: "lookup failed" }, { status: 500 }));
        case "/rest/v1/babies": return Promise.resolve(Response.json({ id: "baby", name: "Amalie" }));
        case "/rest/v1/baby_households": return Promise.resolve(Response.json([{ household_id: "household" }]));
        case "/rest/v1/household_members": return Promise.resolve(Response.json([{ user_id: "caregiver" }]));
        case "/rest/v1/notification_settings": return Promise.resolve(Response.json([]));
        default: throw new Error("Unexpected test request");
      }
    };
    const invoke = () => handler.fetch(new Request("https://edge.example", {
      method: "POST", headers: { "x-sleepy-webhook-secret": "test-secret" },
      body: JSON.stringify({ sleep_id: "sleep", baby_id: "baby", event: "ended", actor_user_id: "actor" }),
    }));
    assertEquals((await invoke()).status, 500);
    assertEquals(calls, ["/rest/v1/sleep", "/rest/v1/rpc/live_activity_end_targets"]);
    calls.length = 0;
    Deno.env.set("VAPID_PUBLIC_KEY", keys.publicKey);
    Deno.env.set("VAPID_PRIVATE_KEY", keys.privateKey);
    const response = await invoke();
    assertEquals(response.status, 200);
    assertEquals((await response.json()).reason, "No opted-in recipients");
    assertEquals(calls.includes("/rest/v1/rpc/live_activity_end_targets"), true);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) setEnv(key, value);
  }
});
