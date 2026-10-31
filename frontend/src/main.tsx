import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startInstallSupport } from "./data/install";
import "./styles.css";
import { applyCachedTheme } from "./prefs";

applyCachedTheme();
startInstallSupport();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
