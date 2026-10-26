import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  validateFamilyMessageRequest,
} from "./validation.ts";

function senderNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): string {
  const metadata = user.user_metadata ?? {};

  for (const key of ["display_name", "full_name", "name"]) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return user.email ?? "Family";
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return json({ ok: true });
    }

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      const authorization = req.headers.get("Authorization");

      if (!authorization) {
        return json({ error: "Unauthorized" }, 401);
      }

      const payload = validateFamilyMessageRequest(
        await req.json(),
      );

      if (!payload) {
        return json({ error: "Invalid message" }, 400);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
      const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
      const vapidSubject = Deno.env.get("VAPID_SUBJECT") ??
        "mailto:sleepy@example.com";

      if (
        !supabaseUrl ||
        !anonKey ||
        !serviceRoleKey ||
        !vapidPublicKey ||
        !vapidPrivateKey
      ) {
        throw new Error("Missing server configuration.");
      }

      // Authenticate using the caller's JWT before using the service role for
      // recipient resolution and push delivery.
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
      });
      const {
        data: { user: sender },
        error: authError,
      } = await callerClient.auth.getUser();

      if (authError || !sender) {
        return json({ error: "Unauthorized" }, 401);
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { babyId, message } = payload;

      const { data: householdRows, error: householdError } = await supabase
        .from("baby_households")
        .select("household_id")
        .eq("baby_id", babyId);

      if (householdError) throw householdError;

      const householdIds = (householdRows ?? []).map(
        (row) => row.household_id as string,
      );

      if (householdIds.length === 0) {
        return json({ error: "Not found" }, 404);
      }

      const { data: memberRows, error: memberError } = await supabase
        .from("household_members")
        .select("user_id")
        .in("household_id", householdIds);

      if (memberError) throw memberError;

      const memberIds = new Set(
        (memberRows ?? []).map((row) => row.user_id as string),
      );

      if (!memberIds.has(sender.id)) {
        return json({ error: "Forbidden" }, 403);
      }

      const recipientIds = [...memberIds].filter(
        (userId) => userId !== sender.id,
      );

      if (recipientIds.length === 0) {
        return json({ sent: 0, reason: "no_push_recipients" });
      }

      const { data: subscriptions, error: subscriptionError } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("user_id", recipientIds);

      if (subscriptionError) throw subscriptionError;

      if (!subscriptions?.length) {
        return json({ sent: 0, reason: "no_push_recipients" });
      }

      let senderName = senderNameFromUser(sender);

      // Profiles are the preferred display-name source. Auth metadata remains
      // a safe fallback for older accounts that do not yet have a profile.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", sender.id)
        .maybeSingle();

      if (profileError) {
        console.warn("Could not load sender profile:", profileError.message);
      } else if (
        typeof profile?.display_name === "string" &&
        profile.display_name.trim()
      ) {
        senderName = profile.display_name.trim();
      }

      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

      const pushPayload = JSON.stringify({
        title: "Sleepy",
        body: `${senderName}: ${message}`,
        url: "/",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: `sleepy-family-message-${babyId}`,
      });

      let sent = 0;

      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            pushPayload,
          );
          sent++;
        } catch (error) {
          const statusCode =
            error && typeof error === "object" && "statusCode" in error
              ? (error as { statusCode?: number }).statusCode
              : undefined;

          console.error("family-message push failed:", {
            subscriptionId: subscription.id,
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
                "family-message: could not remove expired subscription:",
                subscription.id,
                deleteError,
              );
            }
          }
        }
      }

      return json({
        sent,
        reason: sent === 0 ? "no_push_recipients" : undefined,
      });
    } catch (error) {
      console.error("family-message failed:", error);

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
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
    },
  });
}
