// Node 22+ and a locally installed Chromium/Chrome. Isolated temporary profile.
// Optional: SKILLS_TEST_URL, CHROME, QA_OUT. Clipboard contents are restored after testing.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
let base = process.env.SKILLS_TEST_URL;
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = process.env.QA_OUT || path.resolve("verification");
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "skills-browser-"));
let browser, fixture, ws, originalClipboard, sequence = 0;
const pending = new Map(), checks = [], errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error("CDP timeout: " + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function wait(expression) {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); }
  throw Error("Wait: " + expression);
}
async function check(name, expression) {
  const passed = !!await evaluate(expression); checks.push({ name, passed });
  if (!passed) throw Error(name);
}
async function key(key, code, modifiers = 0, text = "") {
  const windowsVirtualKeyCode = ({ Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 })[key] || 0;
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, text, windowsVirtualKeyCode });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}
async function screenshot(name, width = 1200, height = 800) {
  await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(out, name + ".png"), Buffer.from(result.data, "base64"));
  await check("No horizontal overflow: " + name, "document.documentElement.scrollWidth <= innerWidth");
}
try {
  if (!base) {
    fixture = spawn(process.env.PYTHON || "python3", [new URL("./fixture.py", import.meta.url).pathname], {stdio:["ignore","pipe","inherit"]});
    let output=""; fixture.stdout.on("data", b=>output+=b);
    for(let i=0;i<100&&!output.includes("\n");i++)await sleep(50);
    base=output.trim(); if(!base.startsWith("http://127.0.0.1:"))throw Error("Fixture did not start");
  }
  browser = spawn(chrome, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch("http://127.0.0.1:" + port + "/json")).json();
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails);
  };
  await command("Runtime.enable"); await command("Page.enable");
  await command("Browser.grantPermissions", { origin: base, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await command("Page.navigate", { url: base });
  await wait("document.querySelectorAll('.skill-row').length > 0");
  await command("Emulation.setFocusEmulationEnabled", {enabled:true});
  originalClipboard = await evaluate("navigator.clipboard.readText()");
  await check("Catalog loads and selection exists", "!!document.querySelector('.skill-row.selected')");
  await screenshot("launcher-desktop");
  await key("k", "KeyK", 4);
  await check("Command K focuses search", "document.activeElement.id === 'find'");
  await command("Input.insertText", { text: "frontend" });
  await check("Search filters", "[...document.querySelectorAll('.skill-row')].length > 0 && document.querySelectorAll('.skill-row').length < 10");
  await key("Enter", "Enter");
  await wait("!document.querySelector('#copy').disabled && !document.querySelector('#reader').hidden");
  await check("Enter opens a real document", "document.querySelector('#document').textContent.length > 100");
  await screenshot("reader-desktop");
  await evaluate("document.querySelector('#copy').click()");
  await wait("document.querySelector('#toast').textContent.startsWith('Copied')");
  await check("Real clipboard equals exact source", "(async()=>{const id=location.pathname.split('/').pop();const d=await(await fetch('/api/skill/'+id)).json();return await navigator.clipboard.readText()===d.text})()");
  await check("Markdown renders headings and paragraphs", "document.querySelectorAll('#document h2').length > 0 && document.querySelectorAll('#document p').length > 0");
  await evaluate("document.querySelector('.reader-article>.details').open=true;document.querySelector('#shortcut').value='z';document.querySelector('#shortcut').dispatchEvent(new Event('change'))");
  await key("Escape", "Escape");
  await check("Escape returns and preserves search", "!document.querySelector('#launcher').hidden && document.querySelector('#find').value === 'frontend'");
  await key("Escape", "Escape");
  await check("Escape clears query", "document.querySelector('#find').value === ''");
  await key("Escape", "Escape");
  await key("z", "KeyZ", 0, "z");
  await wait("document.querySelector('#toast').textContent.startsWith('Copied')");
  await check("Assigned key selects matching row", "document.querySelector('.skill-row.selected .shortcut').textContent === 'Z'");
  await key("Enter", "Enter");
  await wait("!document.querySelector('#copy').disabled && !document.querySelector('#reader').hidden");
  await check("Shortcut then Enter opens same skill", "document.querySelector('#reader-title').textContent.toLowerCase().includes('frontend')");
  await command("Page.reload");
  await wait("!document.querySelector('#copy').disabled && !document.querySelector('#reader').hidden");
  await check("Deep link and shortcut survive reload", "document.querySelector('#shortcut').value === 'z'");
  const refExists = await evaluate("!!document.querySelector('#document a[href^=\"/skill/\"]')");
  if (refExists) {
    await evaluate("document.querySelector('#document a[href^=\"/skill/\"]').click()");
    await wait("document.querySelector('#copy').textContent === 'Copy document' && !document.querySelector('#copy').disabled");
    await check("Package reference opens", "location.search.includes('file=') && document.querySelector('#document').textContent.length > 0");
    await evaluate("history.back()");
    await wait("document.querySelector('#copy').textContent === 'Copy skill' && !document.querySelector('#copy').disabled");
  }
  await screenshot("reader-mobile", 390, 844);
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await screenshot("reader-dark", 1200, 800);
  await check("System dark theme", "getComputedStyle(document.body).backgroundColor === 'rgb(23, 23, 23)'");
  await key("Escape", "Escape");
  await screenshot("launcher-dark");
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await screenshot("launcher-mobile", 390, 844);
  await key("k", "KeyK", 4);
  await command("Input.insertText", { text: "zzzz-no-skill" });
  await check("Empty search result", "document.querySelectorAll('.skill-row').length === 0 && document.querySelector('.empty').textContent.includes('No skills match')");
  await check("Typing does not trigger shortcut", "document.activeElement.id === 'find' && document.querySelector('#find').value === 'zzzz-no-skill'");
  await key("Escape", "Escape"); await key("Escape", "Escape");
  await evaluate("document.querySelector('#options').click();document.querySelector('#pinned-only').checked=true;document.querySelector('#pinned-only').dispatchEvent(new Event('change'))");
  await check("Pinned only filter", "[...document.querySelectorAll('.skill-row .shortcut')].every(x=>x.textContent)");
  await key("Escape", "Escape");
  await wait("!document.querySelector('dialog[open]')");
  await check("Dialog Escape closes without navigating", "!document.querySelector('dialog[open]') && !document.querySelector('#launcher').hidden");
  await evaluate("document.querySelector('#options').click();document.querySelector('#keys-enabled').checked=false;document.querySelector('#keys-enabled').dispatchEvent(new Event('change'));document.querySelector('#settings').close();document.querySelector('#toast').textContent='sentinel';document.querySelector('#launcher').focus()");
  await key("z", "KeyZ", 0, "z");
  await check("Single-key shortcuts can be disabled", "document.querySelector('#toast').textContent === 'sentinel'");
  await evaluate("document.querySelector('#options').click();document.querySelector('#keys-enabled').checked=true;document.querySelector('#keys-enabled').dispatchEvent(new Event('change'));document.querySelector('#settings').close();Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new Error('denied'))});document.querySelector('.skill-row .copy-row').click()");
  await wait("document.querySelector('#manual').open");
  await check("Denied clipboard has exact manual fallback", "(async()=>{const id=document.querySelector('.skill-row.selected').dataset.id;return document.querySelector('#manual-text').value===(await(await fetch('/api/skill/'+id)).json()).text})()");
  await key("Escape", "Escape");
  await evaluate("document.querySelector('#options').click();document.querySelector('#pinned-only').checked=false;document.querySelector('#pinned-only').dispatchEvent(new Event('change'));document.querySelector('#settings').close()");
  // Delayed reader response must not reopen the document after Escape.
  await evaluate("window.realFetch=fetch;window.release=null;window.fetch=async(...a)=>{const r=await realFetch(...a);if(String(a[0]).startsWith('/api/skill/'))await new Promise(ok=>window.release=ok);return r};document.querySelector('.open-row').click()");
  await wait("!!window.release");
  await key("Escape", "Escape"); await evaluate("window.release();window.fetch=window.realFetch"); await sleep(100);
  await check("Stale response cannot reopen reader", "document.querySelector('#reader').hidden && !document.querySelector('#launcher').hidden");
  await command("Page.navigate", {url:base+"/skill/00000000000000000000"});
  await wait("location.pathname === '/' && !!document.querySelector('.skill-row')");
  await check("Removed skill link returns to current library", "document.querySelector('#reader').hidden && document.querySelector('#toast').textContent.includes('no longer')");
  await check("No runtime errors", JSON.stringify(errors.length === 0));
  console.log(JSON.stringify({ passed: checks.length, errors }));
} catch (error) {
  errors.push(error.stack); console.error(error.stack); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ url: base, checks, errors, isolatedProfile: true }, null, 2));
  if (ws && originalClipboard !== undefined) { try { await evaluate("delete navigator.clipboard.writeText; navigator.clipboard.writeText(" + JSON.stringify(originalClipboard) + ")"); } catch {} }
  if (ws) ws.close();
  if (browser) browser.kill();
  if (fixture) fixture.kill("SIGINT");
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
