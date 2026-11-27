import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LoadBoundary, Splash, lazyRetry } from "./loadable";
// The service desk portal (/portal/<secret>) loads on demand; only its address is checked here.
const PortalPage = lazyRetry(() => import("./components/PortalPage"));
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
      <LoadBoundary>
        <Suspense fallback={<Splash />}>
          <PortalPage />
        </Suspense>
      </LoadBoundary>
    ) : (
      <App />
    )}
  </StrictMode>,
);
