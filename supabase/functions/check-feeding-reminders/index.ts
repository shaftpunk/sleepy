import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

export default {
  async fetch(): Promise<Response> {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
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
          "Missing server configuration",
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

      /*
       * Get all enabled feeding reminders.
       */
      const {
        data: settings,
        error: settingsError,
      } = await supabase
        .from("notification_settings")
        .select("*")
        .eq("feeding_reminder_enabled", true);

      if (settingsError) {
        throw settingsError;
      }

      let notificationsSent = 0;

      for (const setting of settings ?? []) {
        /*
         * Find latest feed for this profile.
         */
        const {
          data: feeds,
          error: feedError,
        } = await supabase
          .from("feed")
          .select(
            "id, starttime, endtime, feedtype, amountml",
          )
          .eq("bbyid", setting.bbyid)
          .order("starttime", {
            ascending: false,
          })
          .limit(1);

        if (feedError) {
          console.error(
            "Could not load feed:",
            setting.bbyid,
            feedError,
          );

          continue;
        }

        const latestFeed = feeds?.[0];

        if (!latestFeed) {
          continue;
        }

        /*
         * Already notified for this feeding.
         */
        if (
          setting.last_feeding_notification_for ===
          latestFeed.id
        ) {
          continue;
        }

        /*
         * For completed feeds use endtime.
         * If there is no endtime, fall back to starttime.
         */
        const feedTime = new Date(
          latestFeed.endtime ??
            latestFeed.starttime,
        );

        const elapsedMinutes =
          (Date.now() - feedTime.getTime()) /
          1000 /
          60;

        if (
          elapsedMinutes <
          setting.feeding_reminder_minutes
        ) {
          continue;
        }

        /*
         * Find push subscriptions for Hamar/Drammen.
         */
        const {
          data: subscriptions,
          error: subscriptionError,
        } = await supabase
          .from("push_subscriptions")
          .select(
            "id, endpoint, p256dh, auth",
          )
          .eq("bbyid", setting.bbyid);

        if (subscriptionError) {
          console.error(
            "Could not load subscriptions:",
            subscriptionError,
          );

          continue;
        }

        const hours = Math.floor(
          elapsedMinutes / 60,
        );

        const minutes = Math.floor(
          elapsedMinutes % 60,
        );

        const elapsedText =
          hours > 0
            ? `${hours}h ${minutes}m`
            : `${minutes}m`;

        const payload = JSON.stringify({
          title: "Feeding reminder 🍼",
          body:
            `It has been ${elapsedText} since the last feeding.`,
          url: "/",
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: `sleepy-feeding-${setting.bbyid}`,
        });

        let sentForProfile = 0;

        for (
          const subscription of
          subscriptions ?? []
        ) {
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

            sentForProfile++;
            notificationsSent++;
          } catch (error: any) {
            console.error(
              "Push failed:",
              error,
            );

            /*
             * Remove expired subscriptions.
             */
            if (
              error?.statusCode === 404 ||
              error?.statusCode === 410
            ) {
              await supabase
                .from("push_subscriptions")
                .delete()
                .eq(
                  "id",
                  subscription.id,
                );
            }
          }
        }

        /*
         * Only mark the feeding as notified if
         * at least one push was successfully sent.
         */
        if (sentForProfile > 0) {
          const { error: updateError } =
            await supabase
              .from(
                "notification_settings",
              )
              .update({
                last_feeding_notification_for:
                  latestFeed.id,

                updated_at:
                  new Date().toISOString(),
              })
              .eq("id", setting.id);

          if (updateError) {
            console.error(
              "Could not update notification state:",
              updateError,
            );
          }
        }
      }

      console.log(
        "Feeding reminder check complete:",
        {
          profiles:
            settings?.length ?? 0,
          notificationsSent,
        },
      );

      return new Response(
        JSON.stringify({
          success: true,
          profilesChecked:
            settings?.length ?? 0,
          notificationsSent,
        }),
        {
          headers: {
            "Content-Type":
              "application/json",
          },
        },
      );
    } catch (error) {
      console.error(error);

      return new Response(
        JSON.stringify({
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        }),
        {
          status: 500,

          headers: {
            "Content-Type":
              "application/json",
          },
        },
      );
    }
  },
};