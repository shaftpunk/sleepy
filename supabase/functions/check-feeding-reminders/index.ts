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
       *
       * Sleepy 3.0:
       * - baby_id identifies the baby
       * - user_id identifies who owns the notification setting
       */
      const {
        data: settings,
        error: settingsError,
      } = await supabase
        .from("notification_settings")
        .select(
          `
          id,
          baby_id,
          user_id,
          feeding_reminder_enabled,
          feeding_reminder_minutes,
          last_feeding_notification_for,
          updated_at
          `,
        )
        .eq("feeding_reminder_enabled", true)
        .not("baby_id", "is", null)
        .not("user_id", "is", null);

      if (settingsError) {
        throw settingsError;
      }

      let notificationsSent = 0;
      let settingsChecked = 0;

      for (const setting of settings ?? []) {
        settingsChecked++;

        /*
         * Safety check.
         */
        if (!setting.baby_id || !setting.user_id) {
          console.warn(
            "Skipping notification setting without baby_id/user_id:",
            setting.id,
          );

          continue;
        }

        /*
         * Find latest feed for this baby.
         *
         * Sleepy 3.0:
         * use baby_id instead of legacy bbyid.
         */
        const {
          data: feeds,
          error: feedError,
        } = await supabase
          .from("feed")
          .select(
            "id, baby_id, starttime, endtime, feedtype, amountml",
          )
          .eq("baby_id", setting.baby_id)
          .is("deleted_at", null)
          .order("starttime", {
            ascending: false,
          })
          .limit(1);

        if (feedError) {
          console.error(
            "Could not load feed for baby:",
            setting.baby_id,
            feedError,
          );

          continue;
        }

        const latestFeed = feeds?.[0];

        if (!latestFeed) {
          console.log(
            "No feed found for baby:",
            setting.baby_id,
          );

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
        const feedTimeValue =
          latestFeed.endtime ??
          latestFeed.starttime;

        if (!feedTimeValue) {
          console.warn(
            "Feed has no usable timestamp:",
            latestFeed.id,
          );

          continue;
        }

        const feedTime = new Date(
          feedTimeValue,
        );

        if (
          Number.isNaN(
            feedTime.getTime(),
          )
        ) {
          console.warn(
            "Invalid feed timestamp:",
            latestFeed.id,
            feedTimeValue,
          );

          continue;
        }

        const elapsedMinutes =
          (Date.now() - feedTime.getTime()) /
          1000 /
          60;

        /*
         * Feeding is not old enough yet.
         */
        if (
          elapsedMinutes <
          setting.feeding_reminder_minutes
        ) {
          continue;
        }

        /*
         * Find push subscriptions belonging
         * to this USER.
         *
         * A user may have several devices.
         */
        const {
          data: subscriptions,
          error: subscriptionError,
        } = await supabase
          .from("push_subscriptions")
          .select(
            "id, endpoint, p256dh, auth, user_id",
          )
          .eq("user_id", setting.user_id);

        if (subscriptionError) {
          console.error(
            "Could not load subscriptions for user:",
            setting.user_id,
            subscriptionError,
          );

          continue;
        }

        if (
          !subscriptions ||
          subscriptions.length === 0
        ) {
          console.log(
            "No push subscriptions found for user:",
            setting.user_id,
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

        /*
         * baby_id is used in the tag so that
         * reminders for different babies
         * remain separate.
         */
        const payload = JSON.stringify({
          title: "Feeding reminder 🍼",

          body:
            `It has been ${elapsedText} since the last feeding.`,

          url: "/",

          icon:
            "/icons/icon-192.png",

          badge:
            "/icons/icon-192.png",

          tag:
            `sleepy-feeding-${setting.baby_id}`,
        });

        let sentForSetting = 0;

        for (
          const subscription of
          subscriptions
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

            sentForSetting++;
            notificationsSent++;
          } catch (error: any) {
            console.error(
              "Push failed:",
              {
                subscriptionId:
                  subscription.id,

                userId:
                  setting.user_id,

                babyId:
                  setting.baby_id,

                statusCode:
                  error?.statusCode,

                error,
              },
            );

            /*
             * Remove expired subscriptions.
             */
            if (
              error?.statusCode === 404 ||
              error?.statusCode === 410
            ) {
              const {
                error:
                  deleteSubscriptionError,
              } = await supabase
                .from(
                  "push_subscriptions",
                )
                .delete()
                .eq(
                  "id",
                  subscription.id,
                );

              if (
                deleteSubscriptionError
              ) {
                console.error(
                  "Could not remove expired push subscription:",
                  subscription.id,
                  deleteSubscriptionError,
                );
              }
            }
          }
        }

        /*
         * Only mark the feeding as notified
         * if at least one push was successfully sent.
         */
        if (sentForSetting > 0) {
          const {
            error: updateError,
          } = await supabase
            .from(
              "notification_settings",
            )
            .update({
              last_feeding_notification_for:
                latestFeed.id,

              updated_at:
                new Date().toISOString(),
            })
            .eq(
              "id",
              setting.id,
            );

          if (updateError) {
            console.error(
              "Could not update notification state:",
              {
                settingId:
                  setting.id,

                updateError,
              },
            );
          }
        }
      }

      console.log(
        "Feeding reminder check complete:",
        {
          settingsChecked,
          notificationsSent,
        },
      );

      return new Response(
        JSON.stringify({
          success: true,

          settingsChecked,

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
      console.error(
        "Feeding reminder check failed:",
        error,
      );

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