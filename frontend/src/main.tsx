import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PortalPage, { portalToken } from "./components/PortalPage";
import { startInstallSupport } from "./data/install";
import "./styles.css";
import { applyCachedTheme } from "./prefs";

applyCachedTheme();
startInstallSupport();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* /portal/<secret>: the service desk portal, for people without an account. */}
    {portalToken ? <PortalPage /> : <App />}
  </StrictMode>,
);
