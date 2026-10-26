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

  const RELOAD_GUARD_KEY = "sleepy-service-worker-reload";
  const RELOAD_GUARD_MS = 30_000;

  // A controller change alone is not proof of a deployment update. In a
  // standalone iOS PWA it can also happen while a worker claims a resumed
  // client. Reload only after this page itself observed updatefound.
  let observedUpdate = false;
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!observedUpdate || reloadingForUpdate || recentlyReloaded()) {
      return;
    }

    reloadingForUpdate = true;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    window.location.reload();
  });

  let registration: ServiceWorkerRegistration | undefined;
  let updateCheck: Promise<void> | undefined;
  let listeningForUpdates = false;

  function recentlyReloaded(): boolean {
    try {
      const previousReload = Number(
        sessionStorage.getItem(RELOAD_GUARD_KEY),
      );

      return Number.isFinite(previousReload) &&
        Date.now() - previousReload < RELOAD_GUARD_MS;
    } catch {
      // Storage can be unavailable in private browsing. The updatefound
      // guard above still prevents unrelated controller changes from reloads.
      return false;
    }
  }

  function watchForUpdates(nextRegistration: ServiceWorkerRegistration) {
    if (listeningForUpdates) return;

    listeningForUpdates = true;
    nextRegistration.addEventListener("updatefound", () => {
      // Ignore first installation; it is not an update and must never force
      // a reload before the application has rendered.
      observedUpdate = navigator.serviceWorker.controller !== null;
    });
  }

  function checkForUpdate(): Promise<void> {
    if (updateCheck) return updateCheck;

    updateCheck = (async () => {
      try {
        registration ??= await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          // Do not let an HTTP cache delay delivery of a deployment's new
          // worker script or its Workbox imports.
          updateViaCache: "none",
        });

        watchForUpdates(registration);
        await registration.update();
      } catch (error) {
        console.error("Could not register the service worker:", error);
      } finally {
        updateCheck = undefined;
      }
    })();

    return updateCheck;
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
