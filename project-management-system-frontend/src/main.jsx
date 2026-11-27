import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App, { Splash } from "./App";
// The service desk portal (/portal/<secret>) loads on demand; only its address is checked here.
const PortalPage = lazy(() => import("./components/PortalPage"));
const portalToken = /^\/portal\/[A-Za-z0-9_-]{20,}\/?$/.test(window.location.pathname);
import { startInstallSupport } from "./data/install";
import "./styles.css";
import { applyCachedTheme } from "./prefs";
applyCachedTheme();
startInstallSupport();
createRoot(/** @type {HTMLElement} */ (document.getElementById("root"))).render(
  <StrictMode>
    {/* /portal/<secret>: the service desk portal, for people without an account. */}
    {portalToken ? (
      <Suspense fallback={<Splash />}>
        <PortalPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
