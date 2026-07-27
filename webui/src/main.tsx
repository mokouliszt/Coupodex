import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initViewport } from "./lib/viewport";

// ネイティブの安全領域・IME と visualViewport から、使える高さを CSS 変数に落とす
initViewport();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
