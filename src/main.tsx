import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { initErrorCapture } from "./services/errorCapture";

// Start capturing console errors before the app mounts
initErrorCapture();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);