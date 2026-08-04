import ReactDOM from "react-dom/client";

import "./styles.css";

async function bootstrap(): Promise<void> {
  const hasExtensionApi =
    typeof chrome !== "undefined" &&
    typeof chrome.runtime?.getURL === "function" &&
    Boolean(chrome.storage?.local);
  if (import.meta.env.DEV && !hasExtensionApi) {
    const { installDevelopmentChromeMock } = await import("./developmentChromeMock");
    installDevelopmentChromeMock();
  }
  const { App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
