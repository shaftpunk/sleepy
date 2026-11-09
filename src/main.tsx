import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";

import "./index.css";

import Root from "./Root";
import { registerServiceWorker } from "./serviceWorkerRegistration";

createRoot(
  document.getElementById("root")!,
).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if (!Capacitor.isNativePlatform()) {
  registerServiceWorker();
}
