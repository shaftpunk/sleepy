import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/*
 * Invoked by a database trigger (public.notify_sleep_event, see the
 * 20260921120000_sleep_event_notifications.sql migration) whenever a sleep
 * session genuinely starts or ends - never for historical edits or splits,
 * since the trigger itself only fires on those two specific transitions.
 *
 * Recipient selection and push delivery both happen here, server-side, with
 * the service role key. The client never sees another user's push
 * subscription or notification settings.
 */
interface SleepEventPayload {
  sleep_id: string;
  baby_id: string;
  event: "started" | "ended";
  actor_user_id: string | null;
}

/*
 * Server-side text. There is currently no per-user language preference
 * stored in Supabase (the app's language setting lives only in each
 * browser's localStorage), so this mirrors the existing
 * check-feeding-reminders precedent of hardcoding one language rather than
 * guessing - Norwegian, since that is this app's default and the language
 * used in its own example. Structured as a small lookup so a future
 * per-user language column could plug in without reshaping the function.
 */
export const TEXT: Record<
  "started" | "ended",
  (babyName: string) => { title: string; body: string }
> = {
  started: (babyName) => ({ title: `${babyName} sovnet 🌙`, body: "" }),
  ended: (babyName) => ({ title: `${babyName} våknet ☀️`, body: "" }),
};

/*
 * True only when the caller presented the exact shared secret configured
 * for this deployment. Exported for testing; the deployment always has a
 * real (non-empty) SLEEP_EVENT_WEBHOOK_SECRET, so the "no secret
 * configured" case below always denies rather than silently allowing.
 */
export function isAuthorizedWebhookCall(
  configuredSecret: string | null | undefined,
  presentedSecret: string | null,
): boolean {
  return Boolean(configuredSecret) && presentedSecret === configuredSecret;
}

/*
 * Narrows an arbitrary request body down to a well-formed SleepEventPayload,
 * or null if it isn't one. Exported for testing.
 */
export function validateSleepEventPayload(
  payload: Partial<SleepEventPayload>,
): SleepEventPayload | null {
  const {
    sleep_id: sleepId,
    baby_id: babyId,
    event,
    actor_user_id: actorUserId = null,
  } = payload;

  if (!sleepId || !babyId || (event !== "started" && event !== "ended")) {
    return null;
  }

  return { sleep_id: sleepId, baby_id: babyId, event, actor_user_id: actorUserId };
}

export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const webhookSecret = Deno.env.get("SLEEP_EVENT_WEBHOOK_SECRET");

      if (
        !isAuthorizedWebhookCall(
          webhookSecret,
          req.headers.get("x-sleepy-webhook-secret"),
        )
      ) {
        return json({ error: "Unauthorized" }, 401);
      }

      const rawPayload = (await req.json()) as Partial<SleepEventPayload>;
      const validated = validateSleepEventPayload(rawPayload);

      if (!validated) {
        return json({ error: "Invalid payload" }, 400);
      }

      const {
        sleep_id: sleepId,
        baby_id: babyId,
        event,
        actor_user_id: actorUserId,
      } = validated;

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
      const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
      const vapidSubject =
        Deno.env.get("VAPID_SUBJECT") ?? "mailto:sleepy@example.com";

      if (
        !supabaseUrl ||
        !serviceRoleKey ||
        !vapidPublicKey ||
        !vapidPrivateKey
      ) {
        throw new Error("Missing server configuration.");
      }

      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

      const supabase = createClient(supabaseUrl, serviceRoleKey);

      /*
       * Re-check the sleep row against the event we were told about. This
       * guards against a stale/duplicate webhook delivery describing a
       * session that has since changed again (e.g. re-opened, deleted).
       */
      const { data: sleepRow, error: sleepError } = await supabase
        .from("sleep")
        .select("id, baby_id, endtime, deleted_at")
        .eq("id", sleepId)
        .maybeSingle();

      if (sleepError) {
        throw sleepError;
      }

      if (!sleepRow || sleepRow.deleted_at || sleepRow.baby_id !== babyId) {
        return json({ sent: 0, reason: "Sleep session not found" });
      }

      if (event === "started" && sleepRow.endtime !== null) {
        return json({ sent: 0, reason: "Session is no longer active" });
      }

      if (event === "ended" && sleepRow.endtime === null) {
        return json({ sent: 0, reason: "Session has no end time" });
      }

      const { data: baby, error: babyError } = await supabase
        .from("babies")
        .select("id, name")
        .eq("id", babyId)
        .maybeSingle();

      if (babyError) {
        throw babyError;
      }

      const babyName = baby?.name ?? "Baby";

      /*
       * Recipients: every household member who can access this baby, has
       * opted in to this event type, and did not perform the action
       * themselves. The self-exclusion is a single filter condition below
       * (actor_user_id) so it can become a per-user opt-in later without
       * restructuring this function.
       */
      const { data: householdRows, error: householdError } = await supabase
        .from("baby_households")
        .select("household_id")
        .eq("baby_id", babyId);

      if (householdError) {
        throw householdError;
      }

      const householdIds = (householdRows ?? []).map(
        (row) => row.household_id,
      );

      if (householdIds.length === 0) {
        return json({ sent: 0, reason: "No household for baby" });
      }

      const { data: memberRows, error: memberError } = await supabase
        .from("household_members")
        .select("user_id")
        .in("household_id", householdIds);

      if (memberError) {
        throw memberError;
      }

      const memberIds = new Set(
        (memberRows ?? []).map((row) => row.user_id as string),
      );

      const notifyColumn =
        event === "started" ? "notify_sleep_started" : "notify_sleep_ended";

      const { data: settings, error: settingsError } = await supabase
        .from("notification_settings")
        .select("user_id")
        .eq("baby_id", babyId)
        .eq(notifyColumn, true)
        .not("user_id", "is", null);

      if (settingsError) {
        throw settingsError;
      }

      const recipientIds = [
        ...new Set(
          (settings ?? [])
            .map((row) => row.user_id as string)
            .filter(
              (userId) => userId !== actorUserId && memberIds.has(userId),
            ),
        ),
      ];

      if (recipientIds.length === 0) {
        return json({ sent: 0, reason: "No opted-in recipients" });
      }

      const { data: subscriptions, error: subscriptionError } =
        await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth, user_id")
          .in("user_id", recipientIds);

      if (subscriptionError) {
        throw subscriptionError;
      }

      const text = TEXT[event](babyName);

      /*
       * Tagging by sleep_id + event lets the browser's own notification
       * stack de-duplicate/replace rather than stack up two bubbles if this
       * ever got delivered more than once for the same transition.
       */
      const payloadJson = JSON.stringify({
        title: text.title,
        body: text.body,
        url: "/",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: `sleepy-sleep-${event}-${sleepId}`,
      });

      let sent = 0;

      for (const subscription of subscriptions ?? []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payloadJson,
          );

          sent++;
        } catch (error) {
          const statusCode =
            error && typeof error === "object" && "statusCode" in error
              ? (error as { statusCode?: number }).statusCode
              : undefined;

          console.error("sleep-notify push failed:", {
            subscriptionId: subscription.id,
            userId: subscription.user_id,
            statusCode,
            error,
          });

          if (statusCode === 404 || statusCode === 410) {
            const { error: deleteError } = await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", subscription.id);

            if (deleteError) {
              console.error(
                "sleep-notify: could not remove expired subscription:",
                subscription.id,
                deleteError,
              );
            }
          }
        }
      }

      console.log("sleep-notify complete:", {
        sleepId,
        babyId,
        event,
        recipients: recipientIds.length,
        subscriptions: subscriptions?.length ?? 0,
        sent,
      });

      return json({
        success: true,
        recipients: recipientIds.length,
        sent,
      });
    } catch (error) {
      console.error("sleep-notify failed:", error);

      return json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      );
    }
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
