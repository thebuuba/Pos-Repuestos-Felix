// Design review only: this entry uses Polymet's demonstration store, never the business database.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./src/styles/fonts.css";
import "./src/styles/theme.css";
import "./src/styles/standards.css";
import { RepuestosFelixPos } from "./src/reference/repuestos-felix-pos.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RepuestosFelixPos />
  </StrictMode>,
);
