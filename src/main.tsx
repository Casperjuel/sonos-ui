import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyGlass, applyTheme, savedGlass, savedTheme } from "./theme";
import "./theme-glass.css";
import { initSheen } from "./sheen";

// before first paint, so there's no flash of the wrong theme
applyGlass(savedGlass());
applyTheme(savedTheme());
initSheen();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
