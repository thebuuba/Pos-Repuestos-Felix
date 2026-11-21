// Design review only: this entry uses Polymet's demonstration store, never the business database.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./src/polymet.css";
import "./standards.css";
import { RepuestosFelixPos } from "./src/polymet/prototypes/repuestos-felix-pos.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RepuestosFelixPos />
  </StrictMode>,
);
