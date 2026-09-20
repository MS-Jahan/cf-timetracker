import React from "react";
import { createRoot } from "react-dom/client";

// Self-hosted so the page makes no external font request (Zero Trust / CSP friendly).
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import App from "./App.jsx";
import "./index.css";
import "./print.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
