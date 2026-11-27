import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
const b = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new", args: ["--no-sandbox", "--force-color-profile=srgb"]
});
const p = await b.newPage();
await p.setViewport({ width: 2500, height: 1560, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(new URL("./schema.html", import.meta.url)).href, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: fileURLToPath(new URL("../../docs/database-schema.png", import.meta.url)), clip: { x: 0, y: 0, width: 2500, height: 1560 } });
await b.close();
console.log("saved");
