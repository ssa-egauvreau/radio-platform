"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// A harmless identity flag (not a capability) so the web bundle can report
// its client platform as "desktop" rather than "web".
contextBridge.exposeInMainWorld("safetDesktop", true);

// The bridge is only for the bundled fallback page (loaded over file://).
// The live dispatch console is a normal web app and gets no extra privileges.
if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktopConsole", {
    getState: () => ipcRenderer.invoke("dispatch:get-state"),
    save: (url) => ipcRenderer.invoke("dispatch:save-url", url),
    retry: () => ipcRenderer.send("dispatch:retry"),
  });
}
