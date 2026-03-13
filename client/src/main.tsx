import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import i18n from "./lib/i18n";
import { isRtl } from "./lib/i18n";

const lang = i18n.language || "he";
document.documentElement.setAttribute("dir", isRtl(lang) ? "rtl" : "ltr");
document.documentElement.setAttribute("lang", lang);

createRoot(document.getElementById("root")!).render(<App />);
