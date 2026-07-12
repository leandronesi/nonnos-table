import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { applyTheme, detectInitialTheme } from "./theme";
import { installGlobalErrorTelemetry } from "./lib/telemetry";

// Setta data-theme PRIMA del render per evitare flash di tema sbagliato.
applyTheme(detectInitialTheme());
installGlobalErrorTelemetry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
