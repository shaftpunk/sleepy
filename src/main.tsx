import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

import { AuthProvider } from "./auth/AuthProvider";
import AuthGate from "./components/AuthGate";
import BabyLoader from "./components/BabyLoader";

createRoot(
  document.getElementById("root")!,
).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <BabyLoader>
          <App />
        </BabyLoader>
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
);