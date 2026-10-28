// Launches the Electron app for `npm run dev:electron`.
//
// The development VM sets ELECTRON_RUN_AS_NODE=1, which makes Electron boot as
// plain Node: require('electron') then returns the binary path instead of the
// API (so `app` is undefined and the main process crashes). We delete the variable
// before spawning so the shell always boots as a real Electron app.
const { spawn } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ["."], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
});

child.on("close", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
    console.error("Failed to launch Electron:", err);
    process.exit(1);
});