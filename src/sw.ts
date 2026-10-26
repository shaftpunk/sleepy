/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

// vite-plugin-pwa's autoUpdate lifecycle options only apply automatically to
// generated workers. This is an injectManifest worker, so keep the lifecycle
// explicit: a new deployment must not wait for the old installed PWA to close.
self.skipWaiting();

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

precacheAndRoute(self.__WB_MANIFEST);

cleanupOutdatedCaches();

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) {
    return;
  }

  let payload: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    url?: string;
    tag?: string;
  };

  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Sleepy",
      body: event.data.text(),
    };
  }

  const title = payload.title ?? "Sleepy";

  const options: NotificationOptions = {
    body: payload.body ?? "",
    icon: payload.icon ?? "/icons/icon-192.png",
    badge: payload.badge ?? "/icons/icon-192.png",
    tag: payload.tag ?? "sleepy-notification",

    data: {
      url: payload.url ?? "/",
    },
  };

  event.waitUntil(
    self.registration.showNotification(title, options),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data?.url as string | undefined) ?? "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        const windowClient = client as WindowClient;

        if ("focus" in windowClient) {
          await windowClient.focus();

          if ("navigate" in windowClient) {
            await windowClient.navigate(targetUrl);
          }

          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
