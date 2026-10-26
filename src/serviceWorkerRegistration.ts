/**
 * Keep installed PWAs current without affecting the worker's push handlers.
 *
 * This is deliberately registered by the app instead of the plugin's small
 * generated registerSW.js file: a custom injectManifest worker needs explicit
 * lifecycle handling and iOS benefits from checking again when it resumes.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  // Do not reload a first-time install. Reload only after a newer worker has
  // replaced an existing controller, so the current document also gets that
  // worker's matching precached index.html and hashed assets.
  const hadController = navigator.serviceWorker.controller !== null;
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloadingForUpdate) {
      return;
    }

    reloadingForUpdate = true;
    window.location.reload();
  });

  let registration: ServiceWorkerRegistration | undefined;

  async function checkForUpdate() {
    try {
      registration ??= await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        // Do not let an HTTP cache delay delivery of a deployment's new
        // worker script or its Workbox imports.
        updateViaCache: "none",
      });

      await registration.update();
    } catch (error) {
      console.error("Could not register the service worker:", error);
    }
  }

  window.addEventListener("load", () => {
    void checkForUpdate();
  }, { once: true });

  // Installed iOS PWAs are often resumed instead of navigated. Check when
  // they return to the foreground as well as on a cold launch.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkForUpdate();
    }
  });
}
