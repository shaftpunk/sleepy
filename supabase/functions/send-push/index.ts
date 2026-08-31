import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

interface PushRequest {
  bbyid: "Hamar" | "Drammen";
  title?: string;
  body?: string;
  url?: string;
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }

    try {
      const {
        bbyid,
        title = "Sleepy",
        body = "",
        url = "/",
      } = (await req.json()) as PushRequest;

      if (!bbyid) {
        return json(
          { error: "bbyid is required" },
          400,
        );
      }

      const supabaseUrl =
        Deno.env.get("SUPABASE_URL");

      const serviceRoleKey =
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      const vapidPublicKey =
        Deno.env.get("VAPID_PUBLIC_KEY");

      const vapidPrivateKey =
        Deno.env.get("VAPID_PRIVATE_KEY");

      const vapidSubject =
        Deno.env.get("VAPID_SUBJECT") ??
        "mailto:sleepy@example.com";

      if (
        !supabaseUrl ||
        !serviceRoleKey ||
        !vapidPublicKey ||
        !vapidPrivateKey
      ) {
        throw new Error(
          "Missing server configuration.",
        );
      }

      webpush.setVapidDetails(
        vapidSubject,
        vapidPublicKey,
        vapidPrivateKey,
      );

      const supabase = createClient(
        supabaseUrl,
        serviceRoleKey,
      );

      const { data: subscriptions, error } =
        await supabase
          .from("push_subscriptions")
          .select(
            "id, endpoint, p256dh, auth",
          )
          .eq("bbyid", bbyid);

      if (error) {
        throw error;
      }

      const payload = JSON.stringify({
        title,
        body,
        url,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: `sleepy-${bbyid}`,
      });

      const results = await Promise.allSettled(
        (subscriptions ?? []).map(
          async (subscription) => {
            try {
              await webpush.sendNotification(
                {
                  endpoint:
                    subscription.endpoint,

                  keys: {
                    p256dh:
                      subscription.p256dh,

                    auth:
                      subscription.auth,
                  },
                },
                payload,
              );

              return {
                id: subscription.id,
                success: true,
              };
            } catch (error: any) {
              const statusCode =
                error?.statusCode;

              if (
                statusCode === 404 ||
                statusCode === 410
              ) {
                await supabase
                  .from("push_subscriptions")
                  .delete()
                  .eq(
                    "id",
                    subscription.id,
                  );
              }

              throw error;
            }
          },
        ),
      );

      const sent = results.filter(
        (result) =>
          result.status === "fulfilled",
      ).length;

      const failed = results.length - sent;

      return json({
        success: true,
        subscriptions: results.length,
        sent,
        failed,
      });
    } catch (error) {
      console.error(error);

      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        },
        500,
      );
    }
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );
}