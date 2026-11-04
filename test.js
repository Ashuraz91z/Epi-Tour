// Vérifie la collecte et le penthouse : node --test
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createStore, describeTool, ingest, normalize, sanitizeProfile, snapshot } from "./core.js";
import { officePublic, officeTierForLevel } from "./upgrades.js";
import { openDb } from "./db.js";
import { createApp, slugify, spectatorSnapshot } from "./penthouse.js";

async function open() {
  const db = openDb(":memory:");
  const app = createApp({ code: "porte", db }).listen(0, "127.0.0.1");
  await new Promise(r => app.once("listening", r));
  const url = `http://127.0.0.1:${app.address().port}`;
  const call = (path, body, headers = {}) => fetch(url + path, { method: "POST", body: JSON.stringify(body), headers });
  return { app, url, db, call };
}

test("entrée : code, appartement, clé, cookie", async () => {
  const { app, url, db, call } = await open();
  try {
    assert.equal((await call("/api/join", { name: "Lucas", code: "faux" })).status, 403);
    const r = await call("/api/join", { name: "Lucas", code: "porte" });
    const { slug, token } = await r.json();
    assert.equal(slug, "lucas");
    assert.ok(token.length > 20);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(url + "/api/state")).status, 401, "sans cookie, rien à voir");
    assert.equal((await fetch(url + "/api/live")).status, 401, "la liste des directs aussi");

    const again = await (await call("/api/join", { name: "lucas", code: "porte" })).json();
    assert.equal(again.token, undefined, "la clé n'est donnée qu'une fois");
    assert.equal(again.slug, "lucas");

    const post = (p, t = token) => call("/e?src=claude&host=mac", p, { "X-Tour-Token": t });
    assert.equal((await post({ hook_event_name: "Stop", session_id: "a" }, "fausse")).status, 401);
    assert.equal((await post({ hook_event_name: "UserPromptSubmit", session_id: "a", prompt: "corrige le bug", cwd: "/p/ai-trade" })).status, 204);
    const st = await (await fetch(url + "/api/state", { headers: { cookie } })).json();
    assert.equal(st.apartments[0].name, "Lucas");
    assert.equal(st.apartments[0].sessions[0].task, "corrige le bug");

    // Télé commune : réservée aux personnes entrées, chaînes de la liste seulement, vue par tout le monde
    assert.equal((await call("/api/tv", { channel: "lofigirl" })).status, 401);
    assert.equal((await call("/api/tv", { channel: "inconnue" }, { cookie })).status, 400);
    assert.equal((await call("/api/tv", { channel: "lofigirl", by: "Lucas" }, { cookie })).status, 200);
    assert.deepEqual((await (await fetch(url + "/api/state", { headers: { cookie } })).json()).tv.channel, "lofigirl");

    assert.equal((await call("/api/key", { name: "Lucas", code: "porte" })).status, 403);
    const other = await (await call("/api/join", { name: "Paul", code: "porte" })).json();
    assert.equal((await call("/api/key", { name: "Lucas", code: "porte" }, { "X-Tour-Token": other.token })).status, 403);
    assert.equal((await post({ hook_event_name: "Stop", session_id: "a" })).status, 204, "un refus conserve la clé actuelle");
    const fresh = await (await call("/api/key", { name: "Lucas", code: "porte" }, { "X-Tour-Token": token })).json();
    assert.equal((await post({ hook_event_name: "Stop", session_id: "a" })).status, 401, "l'ancienne clé ne marche plus");
    assert.equal((await post({ hook_event_name: "Stop", session_id: "a" }, fresh.token)).status, 204);
    assert.equal(db.get("lucas").store.sessions["claude:mac:a"].state, "fini");
  } finally {
    app.close();
  }
});

test("modèles 3D servis, chemins hors liste refusés", async () => {
  const { app, url } = await open();
  try {
    const r = await fetch(url + "/assets/robot.glb");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "model/gltf-binary");
    assert.ok((await r.arrayBuffer()).byteLength > 100_000);
    for (const bad of ["/assets/..%2Fpenthouse.js", "/assets/inconnu.glb"]) {
      const res = await fetch(url + bad);
      await res.text();
      assert.equal(res.status, 404);
    }
  } finally {
    app.close();
  }
});

test("quitter le penthouse : avec sa clé seulement", async () => {
  const { app, db, call } = await open();
  try {
    const { token } = await (await call("/api/join", { name: "Invité", code: "porte" })).json();
    await (await call("/api/join", { name: "Autre", code: "porte" })).json();
    assert.equal((await call("/api/leave", {}, { "X-Tour-Token": "fausse" })).status, 401);
    const r = await call("/api/leave", {}, { "X-Tour-Token": token });
    assert.deepEqual(await r.json(), { slug: "invite" });
    assert.deepEqual(db.all().map(a => a.slug), ["autre"]);
  } finally {
    app.close();
  }
});

test("trop d'essais du code : refusé", async () => {
  const { app, call } = await open();
  try {
    let last;
    for (let i = 0; i < 12; i++) last = (await call("/api/join", { name: "x", code: "faux" }, { "X-Forwarded-For": "9.9.9.9" })).status;
    assert.equal(last, 429);
  } finally {
    app.close();
  }
});

test("collecte : sessions, quotas, compteurs, santé (cas de la v1)", () => {
  const store = createStore();
  ingest(store, "x", "mac", { hook_event_name: "UserPromptSubmit", session_id: "a", prompt: "corrige", cwd: "/p/ai-trade" }, 100);
  ingest(store, "x", "mac", { hook_event_name: "PreToolUse", session_id: "a", tool_name: "Bash", tool_input: { command: "pytest -q" } }, 101);
  ingest(store, "x", "mac", { hook_event_name: "pre_tool_call", session_id: "h", profile: "developer", tool_name: "terminal" }, 102);
  ingest(store, "x", "mac", { hook_event_name: "PostToolUse", session_id: "ignoré" }, 103);
  const st = snapshot(store, 104);
  assert.deepEqual(st.sessions.map(s => s.sid).sort(), ["a", "h"]);
  assert.equal(store.sessions["x:mac:a"].action, "Bash · pytest -q");
  assert.equal(store.sessions["x:mac/developer:h"].host, "mac/developer");
  assert.equal(st.today.x.sessions, 2);

  ingest(store, "u", "dev", { hook_event_name: "usage", usage: { claude: { ts: 100, five_hour: { pct: 20 } }, pirate: {} } }, 105);
  ingest(store, "u", "dev", { hook_event_name: "usage", usage: { claude: { ts: 50, five_hour: { pct: 10 } } } }, 106);
  assert.equal(store.usage.claude.ts, 100);
  assert.equal(store.usage.pirate, undefined);

  ingest(store, "tour", "hermes", { hook_event_name: "health", health: { services: [{ label: "x", ok: true }] } }, 107);
  assert.equal(store.health.services[0].ok, true);
});

test("demande d'autorisation : état à part", () => {
  assert.equal(normalize({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }).state, "autorisation");
  assert.equal(normalize({ hook_event_name: "Notification", message: "Claude is waiting for your input" }).state, "attend");
});

test("deux copies du serveur sur la même base : rien ne se perd", async () => {
  const dir = mkdtempSync(join(tmpdir(), "penthouse-"));
  const a = openDb(join(dir, "p.db")), b = openDb(join(dir, "p.db"));
  assert.ok(a.create("lucas", "Lucas", "h1", 50));
  assert.ok(b.create("sami", "Sami", "h2", 50), "la copie b voit la base partagée");
  assert.equal(a.create("sami", "Sami", "h3", 50), false, "nom déjà pris, même créé par l'autre copie");
  a.change("lucas", st => ingest(st, "claude", "mac", { hook_event_name: "UserPromptSubmit", session_id: "x", prompt: "un" }));
  b.change("lucas", st => ingest(st, "codex", "mac", { hook_event_name: "UserPromptSubmit", session_id: "y", prompt: "deux" }));
  assert.deepEqual(Object.keys(a.get("lucas").store.sessions).sort(), ["claude:mac:x", "codex:mac:y"]);
  assert.deepEqual(a.all().map(x => x.slug), ["lucas", "sami"]);
  rmSync(dir, { recursive: true });
});

test("divers", () => {
  assert.equal(describeTool("mcp__Claude_Browser__computer", {}), "Claude_Browser · computer");
  assert.equal(slugify("  Élodie Martin! "), "elodie-martin");
  const store = createStore();
  ingest(store, "claude", "mac", { hook_event_name: "Stop", session_id: "v" }, 1000);
  assert.equal(snapshot(store, 1000 + 3601).sessions.length, 0, "session finie depuis plus d'une heure retirée");
});


test("accents refusés sans plantage et noms internes réservés", async () => {
  const { app, call: rawCall } = await open();
  const call = (path, body) => rawCall(path, body, { "X-Forwarded-For": "8.8.8.8" });
  try {
    assert.equal((await call("/api/join", { name: "Lucas", code: "éxxxx" })).status, 403);
    for (const name of ["roof", "LOUNGE", "Clüb"])
      assert.equal((await call("/api/join", { name, code: "porte" })).status, 400);
    assert.equal((await call("/api/join", { name: "Élodie", code: "porte" })).status, 200);
  } finally { app.close(); }
});


test("Hermes : cinq visibles, priorité aux demandes et au travail, nettoyage persistant", async () => {
  const { app, url, db, call } = await open();
  try {
    const joined = await call("/api/join", { name: "Limite Hermes", code: "porte" }, { "X-Forwarded-For": "7.7.7.7" });
    const cookie = joined.headers.get("set-cookie").split(";")[0];
    const now = Date.now() / 1000;
    db.change("limite-hermes", store => {
      for (let i = 0; i < 8; i++) ingest(store, "hermes", "test", { hook_event_name: "agent:end", session_id: "idle" + i }, now - i);
      ingest(store, "hermes", "test", { hook_event_name: "pre_tool_call", session_id: "working" }, now - 100);
      ingest(store, "hermes", "test", { hook_event_name: "Notification", message: "permission", session_id: "approval" }, now - 1000);
      ingest(store, "hermes", "test", { hook_event_name: "pre_tool_call", session_id: "stale" }, now - 3601);
      ingest(store, "hermes", "test", { hook_event_name: "agent:end", session_id: "expired" }, now - 3601);
      ingest(store, "claude", "test", { hook_event_name: "UserPromptSubmit", session_id: "claude" }, now - 901);
    });
    const state = await (await fetch(url + "/api/state", { headers: { cookie } })).json();
    const sessions = state.apartments[0].sessions, hermes = sessions.filter(s => s.src === "hermes");
    assert.equal(hermes.length, 5);
    assert.ok(hermes.some(s => s.sid === "working"));
    assert.ok(hermes.some(s => s.sid === "approval"));
    assert.ok(hermes.some(s => s.sid === "idle0"));
    assert.ok(sessions.some(s => s.src === "claude"), "autres outils inchangés");
    const stored = db.get("limite-hermes").store.sessions;
    assert.equal(stored["hermes:test:stale"], undefined);
    assert.equal(stored["hermes:test:expired"], undefined);
    assert.ok(stored["hermes:test:idle7"], "sessions récentes masquées conservées");
    assert.equal((await (await fetch(url + "/api/state", { headers: { cookie } })).json()).apartments[0].sessions.filter(s => s.src === "hermes").length, 5);
  } finally { app.close(); }
});


test("Hermes reste suivi avant une heure, puis expire", () => {
  const store = createStore();
  ingest(store, "hermes", "test", { hook_event_name: "pre_tool_call", session_id: "long" }, 1000);
  assert.equal(snapshot(store, 1000 + 3599).sessions.length, 1);
  assert.equal(snapshot(store, 1000 + 3601).sessions.length, 0);
});


test("bureaux fixes : départ, arrivée et réorganisation ne déplacent pas les occupants", async () => {
  const { assignDeskSlots } = await import("./public/desk-slots.js");
  const initial = assignDeskSlots(["a", "b", "c"], new Map());
  assert.deepEqual([...initial.values()], [0, 1, 2]);
  const after = assignDeskSlots(["new", "c", "b"], initial);
  assert.equal(after.get("b"), 1);
  assert.equal(after.get("c"), 2);
  assert.equal(after.get("new"), 0);
  const only = assignDeskSlots(["c"], after);
  assert.equal(only.get("c"), 2);
  assert.equal(assignDeskSlots(["other"], only).get("other"), 0);
  assert.equal(assignDeskSlots([], after).size, 0);
  const many = assignDeskSlots(Array.from({ length: 15 }, (_, i) => String(i)), new Map());
  assert.equal(new Set(many.values()).size, 15);
});


test("Codex : autorisation puis reprise sur la même session", async () => {
  const { app, url, call } = await open();
  try {
    const joined = await call("/api/join", { name: "Permissions", code: "porte" }, { "X-Forwarded-For": "6.6.6.6" });
    const { token } = await joined.json();
    const cookie = joined.headers.get("set-cookie").split(";")[0];
    const event = async hook_event_name => {
      assert.equal((await call("/e?src=codex&host=mac", { hook_event_name, session_id: "same", tool_name: "Bash", tool_input: { command: "npm test" } }, { "X-Tour-Token": token })).status, 204);
      return (await (await fetch(url + "/api/state", { headers: { cookie } })).json()).apartments[0].sessions;
    };
    assert.equal((await event("PreToolUse"))[0].state, "travaille");
    let sessions = await event("PermissionRequest");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].state, "autorisation");
    assert.match(sessions[0].action, /accord requis.*Bash.*npm test/);
    assert.equal((await event("PostToolUse"))[0].state, "travaille");
    await event("PermissionRequest");
    assert.equal((await event("Stop"))[0].state, "fini");
  } finally { app.close(); }
});

// Exerce les trajectoires sans WebGL : les mobiles restent finis et la préférence de mouvement est respectée.
test("extérieur : trajectoires bornées et réduction des animations", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const motion = source.slice(source.indexOf("function animateOutside(t)"), source.indexOf("// La tour sous l'étage"));
  const car = { position: {} }, plane = { position: {} };
  const bird = { position: { set(...v) { this.values = v; } }, rotation: {} };
  const wings = [{ rotation: {} }, { rotation: {} }];
  const context = { traffic: [{ car, axis: "x", direction: -1, start: 0, speed: 5 }], planes: [plane], birds: [{ bird, wings }], reducedOutsideMotion: { matches: false } };
  runInNewContext(motion + "; animateOutside(1e6)", context);
  assert.ok(Math.abs(car.position.x) <= 250);
  assert.ok(Math.abs(plane.position.x) <= 320);
  assert.ok(bird.position.values.every(Number.isFinite));
  context.reducedOutsideMotion.matches = true;
  runInNewContext("animateOutside(0)", context);
  const frozen = JSON.stringify([car, plane, bird, wings]);
  runInNewContext("animateOutside(123)", context);
  assert.equal(JSON.stringify([car, plane, bird, wings]), frozen);
});

test("ville : chaque voie de circulation repose sur une chaussée", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const meshes = [];
  class Instances {
    constructor() { this.matrices = []; meshes.push(this); }
    setMatrixAt(k, matrix) { this.matrices[k] = { scale: [...matrix.scale], position: [...matrix.position] }; }
  }
  const m4 = { makeScale(...scale) { this.scale = scale; return this; }, setPosition(...position) { this.position = position; return this; } };
  runInNewContext(source.slice(source.indexOf("  const roads ="), source.indexOf("  const stars =")), {
    THREE: { InstancedMesh: Instances, BoxGeometry: class {}, BufferGeometry: class { setAttribute() {} }, Float32BufferAttribute: class {}, LineSegments: class {}, LineBasicMaterial: class {} },
    mat() {}, scene: { add() {} }, m4, GROUND: -150, CELL: 18,
  });
  assert.equal(meshes[0].matrices.length, 58);
  for (let i = 0; i < 24; i++) {
    const axis = i % 3 ? 0 : 2, across = axis === 0 ? 2 : 0;
    const lane = (Math.floor(i / 3) - 6) * 18 + 9;
    const road = meshes[0].matrices.find(m => m.position[across] === lane && m.scale[axis] === 540);
    assert.ok(road);
    assert.ok(250 + 1.25 < road.scale[axis] / 2, "voiture entière sur la route, même en bout de trajet");
    assert.ok(1.1 + 0.55 < road.scale[across] / 2, "voie et carrosserie dans la chaussée");
    assert.equal(road.position[1] + road.scale[1] / 2, -150 + 0.18);
  }
});

test("panneau : classement en direct, sessions silencieuses exclues et égalités stables", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const rank = source.slice(source.indexOf("function agentRanking("), source.indexOf("function updateBillboard("));
  const context = { stateOf: (s, now) => s.state === "travaille" && now - s.updated > 600 ? "silencieux" : s.state,
    apartments: [
      { name: "Zoé", sessions: [{ state: "travaille", updated: 999 }, { state: "travaille", updated: 0 }] },
      { name: "Alice", sessions: [{ state: "travaille", updated: 999 }] },
      { name: "Lucas", sessions: [{ state: "travaille", updated: 999 }, { state: "travaille", updated: 999 }] },
      { name: "Pause", sessions: [{ state: "fini", updated: 999 }] },
    ] };
  const result = runInNewContext(rank + "; agentRanking(apartments, 1000)", context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ name: "Lucas", active: 2 }, { name: "Alice", active: 1 }, { name: "Zoé", active: 1 }]);
  assert.equal(runInNewContext("agentRanking([], 1000).length", context), 0);
});

test("panneau quotas : restants bornés, absence et reset expiré explicites", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("function quotaRemaining("), source.indexOf("function updateUsageBoard("));
  const context = { usage: { claude: { five_hour: { pct: 27, resets_at: 2000 }, seven_day: { pct: 50, resets_at: 900 } }, chatgpt: { five_hour: { pct: 120 } } } };
  const lines = runInNewContext(fn + "; quotaRows(usage, 1000)", context);
  assert.equal(lines[0].remaining, 73);
  assert.equal(lines[1].remaining, null);
  assert.match(lines[1].reset, /Nouvelle mesure attendue/);
  assert.equal(lines[2].remaining, 0);
  assert.equal(lines[3].remaining, null);
  assert.match(lines[3].reset, /non reçues/);
  assert.equal(runInNewContext("quotaRows(undefined, 1000).length", context), 4);
});


test("connexion : une commande, sessions importées, outils inchangés et installation idempotente", async () => {
  const { app, url, call, db } = await open();
  const home = mkdtempSync(join(tmpdir(), "penthouse-install-"));
  const run = promisify(execFile);
  try {
    const { token } = await (await call("/api/join", { name: "Installation", code: "porte" })).json();
    assert.equal((await fetch(url + "/api/connection")).status, 401);
    const info = await (await fetch(url + "/api/connection", { headers: { "X-Tour-Token": token } })).json();
    assert.deepEqual(info, { slug: "installation", name: "Installation" });
    mkdirSync(join(home, ".claude/projects/demo"), { recursive: true }); mkdirSync(join(home, ".codex/sessions"), { recursive: true });
    const bin = join(home, "bin"); mkdirSync(bin);
    for (const name of ["launchctl", "crontab"]) writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const eventAt = new Date().toISOString();
    writeFileSync(join(home, ".claude/projects/demo/recent.jsonl"), JSON.stringify({ type: "assistant", sessionId: "imported", timestamp: eventAt, cwd: "/private/project", message: { model: "test-model", content: [{ type: "text", text: "PRIVATE NOT SENT" }], stop_reason: "end_turn" } }) + "\n");
    writeFileSync(join(home, ".claude/settings.json"), JSON.stringify({ keep: true, hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook" }] }] } }));
    const script = fileURLToPath(new URL("./public/install.sh", import.meta.url));
    const env = { ...process.env, HOME: home, PENTHOUSE_URL: url, PATH: join(home, "bin") + ":" + process.env.PATH };
    await assert.rejects(run("sh", [script, "wrong"], { env }));
    assert.throws(() => readFileSync(join(home, ".config/tour/secret")));
    await run("sh", [script, token], { env });
    await run("sh", [script, token], { env });
    const cfg = JSON.parse(readFileSync(join(home, ".claude/settings.json")));
    assert.equal(cfg.keep, true);
    assert.equal(cfg.hooks.Stop.length, 1, "ne modifie plus les hooks des outils");
    const seen = db.get("installation").store.seen;
    const host = readFileSync(join(home, ".config/tour/host"), "utf8").trim();
    assert.deepEqual(seen[host].readers, { claude: true, codex: true });
    assert.equal(Object.keys(db.get("installation").store.sessions).length, 1, "seule la session réelle est importée");
    assert.equal(db.get("installation").store.sessions["claude:" + host + ":imported"].project, "project");
    assert.ok(!JSON.stringify(db.get("installation").store).includes("PRIVATE NOT SENT"));
    await call("/e?src=codex&host=" + encodeURIComponent(host), { hook_event_name: "SessionStart", session_id: "real" }, { "X-Tour-Token": token });
    assert.equal(db.get("installation").store.seen[host].readers.codex, true);
    assert.ok(db.get("installation").store.seen[host].events.codex);
    await assert.rejects(run("sh", [script, "different"], { env }));
    assert.equal(readFileSync(join(home, ".config/tour/secret"), "utf8").trim(), token);
    writeFileSync(join(home, ".codex/hooks.json"), "bad json");
    await run("sh", [script, token], { env });
    assert.equal(readFileSync(join(home, ".codex/hooks.json"), "utf8"), "bad json", "les fichiers des outils ne sont ni lus ni modifiés");
  } finally { app.close(); rmSync(home, { recursive: true, force: true }); }
});

test("journaux : un relevé ancien ne remplace pas une autorisation récente", () => {
  const store = createStore();
  ingest(store, "codex", "mac", { hook_event_name: "PermissionRequest", session_id: "same", tool_name: "Bash" }, 1000);
  ingest(store, "codex", "mac", { hook_event_name: "Stop", session_id: "same", sync: true, observed_at: 900 }, 1010);
  assert.equal(store.sessions["codex:mac:same"].state, "autorisation");
  assert.equal(store.feed.length, 1);
  ingest(store, "codex", "mac", { hook_event_name: "Stop", session_id: "same", sync: true, observed_at: 1020 }, 1030);
  assert.equal(store.sessions["codex:mac:same"].state, "fini");
  assert.equal(store.sessions["codex:mac:same"].updated, 1020);
});

test("lecteur Codex : session, projet, état et quota sans contenu de conversation", async () => {
  const run = promisify(execFile);
  const script = fileURLToPath(new URL("./collecteurs/tour-sync", import.meta.url));
  const python = `import runpy,sys,json
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
parse=runpy.run_path(sys.argv[1])['parse']
rows=[{'type':'session_meta','payload':{'id':'session-a'}},
 {'type':'turn_context','payload':{'cwd':'/private/project','model':'test'}},
 {'timestamp':'2026-11-03T00:00:00Z','type':'event_msg','payload':{'type':'task_started','message':'PRIVATE'}},
 {'timestamp':'2026-11-03T00:00:01Z','type':'event_msg','payload':{'type':'token_count','rate_limits':{'primary':{'used_percent':27,'resets_at':2000}}}},
 {'timestamp':'2026-11-03T00:00:02Z','type':'event_msg','payload':{'type':'task_complete','last_agent_message':'PRIVATE'}}]
p=parse('codex',[json.dumps(r) for r in rows]+['broken-json'])
assert p['session_id']=='session-a' and p['cwd']=='project'
assert p['hook_event_name']=='Stop'
assert p['usage']['chatgpt']['five_hour']['pct']==27
assert 'PRIVATE' not in json.dumps(p)
`;
  await run("python3", ["-c", python, script]);
});


test("spectateur : personnes et activité visibles, détails privés absents", () => {
  const state = spectatorSnapshot({ slug: "lucas", name: "Lucas", created: 10,
    sessions: [{ src: "codex", host: "private-machine", sid: "session", state: "travaille", started: 1, updated: 2, task: "private-task", action: "private-command", project: "private-project", model: "private-model" }],
    usage: { private: true }, seen: { private: true }, feed: [{ action: "private-feed" }] });
  assert.equal(state.sessions[0].state, "travaille");
  assert.equal(state.name, "Lucas");
  assert.ok(!JSON.stringify(state).includes("private"));
  assert.equal(state.sessions[0].host, spectatorSnapshot({ ...state, sessions: [{ ...state.sessions[0], host: "private-machine" }] }).sessions[0].host);
});

test("spectateur : salle seule, aucun appartement créé, données filtrées et écritures refusées", async () => {
  const { app, url, db, call: rawCall } = await open();
  const call = (path, body, headers = {}) => rawCall(path, body, { "X-Forwarded-For": "5.5.5.5", ...headers });
  try {
    const joinResponse = await call("/api/join", { name: "Lucas", code: "porte" });
    const residentCookie = joinResponse.headers.get("set-cookie").split(";")[0];
    const { token } = await joinResponse.json();
    await call("/e?src=codex&host=private-machine", { hook_event_name: "UserPromptSubmit", session_id: "test", prompt: "private-task", cwd: "/private-project" }, { "X-Tour-Token": token });
    assert.equal((await call("/api/spectate", { room: "inconnue" })).status, 404);
    assert.equal((await call("/api/spectate", { room: "   " })).status, 404);
    const response = await call("/api/spectate", { room: "  PENTHOUSE " }, { "X-Forwarded-Proto": "https" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax;.*Secure/);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal(db.count(), 1);
    const state = await (await fetch(url + "/api/state", { headers: { cookie } })).json();
    assert.deepEqual(state.viewer, { role: "spectator", room: "Penthouse" });
    assert.equal(state.apartments[0].sessions.length, 1);
    assert.ok(!JSON.stringify(state).includes("private"));
    assert.equal((await call("/api/tv", { channel: "lofigirl" }, { cookie })).status, 401);
    assert.equal((await call("/api/key", { name: "Lucas" }, { cookie })).status, 403);
    assert.equal((await call("/api/leave", {}, { cookie })).status, 401);
    assert.equal((await call("/e?src=codex", { hook_event_name: "Stop" }, { cookie })).status, 401);
    const residentState = await (await fetch(url + "/api/state", { headers: { cookie: residentCookie } })).json();
    assert.equal(residentState.apartments[0].sessions[0].task, "private-task");
    assert.equal((await call("/api/exit-spectator", {}, { cookie: residentCookie })).status, 403);
    assert.match((await call("/api/exit-spectator", {}, { cookie })).headers.get("set-cookie"), /Max-Age=0/);
  } finally { app.close(); }
});

test("spectateur : quotas autorisés sans données de compte supplémentaires", () => {
  const view = spectatorSnapshot({ slug: "a", name: "A", created: 1, sessions: [], usage: {
    claude: { ts: 5, email: "private-email", five_hour: { pct: 25, resets_at: 100, private: "secret" }, seven_day: { pct: 150 } },
    chatgpt: { five_hour: { pct: 40 } }, other: { secret: true },
  } });
  assert.deepEqual(view.usage.claude.five_hour, { pct: 25, resets_at: 100 });
  assert.equal(view.usage.claude.seven_day.pct, 100);
  assert.equal(view.usage.chatgpt.five_hour.pct, 40);
  assert.ok(!JSON.stringify(view).includes("private"));
  assert.ok(!JSON.stringify(view).includes("secret"));
  assert.equal(view.usage.other, undefined);
});

test("visite spectateur : tous les usages, tous les étages, deux écrans et retour au début", async () => {
  const { spectatorStep } = await import("./public/spectator-tour.js");
  const floors = ["roof", "lucas", "paul", "lounge", "club"];
  assert.equal(spectatorStep(0, floors, 7).kind, "dashboard");
  assert.equal(spectatorStep(14, floors, 7).page, 1);
  floors.forEach((floor, i) => assert.equal(spectatorStep(28 + i * 12, floors, 7).floor, floor));
  assert.equal(spectatorStep(88, floors, 7).kind, "agents");
  assert.equal(spectatorStep(98, floors, 7).kind, "usage");
  const duration = spectatorStep(0, floors, 7).duration;
  assert.equal(spectatorStep(duration, floors, 7).kind, "dashboard");
  assert.equal(spectatorStep(duration, floors, 7).page, 0);
  assert.equal(spectatorStep(28, floors, 3, 1).page, 2, "chaque résident a sa page sur téléphone");
  assert.equal(spectatorStep(0, [], 0).kind, "dashboard");
});


test("quota hebdomadaire : même reste dans le dashboard et la fiche résident", async () => {
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const helper = source.slice(source.indexOf("function quotaRemaining("), source.indexOf("function quotaRows("));
  const meter = source.slice(source.indexOf("function meter("), source.indexOf("let previousApprovals"));
  const context = { w: { pct: 12, resets_at: 2000 } };
  const html = runInNewContext(helper + meter + '; meter("ChatGPT semaine", w, "green", 1000)', context);
  assert.match(html, /88 % restants/);
  assert.match(html, /width:88%/);
  assert.doesNotMatch(html, /12 %/);
  assert.match(runInNewContext('meter("Semaine", w, "green", 3000)', context), /Nouvelle mesure attendue/);
});


test("lien spectateur : accès direct sans formulaire ni création de résident", async () => {
  const { app, url, db } = await open();
  try {
    const response = await fetch(url + "/spectateur", { redirect: "manual", headers: { "X-Forwarded-Proto": "https" } });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax;.*Secure/);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const state = await (await fetch(url + "/api/state", { headers: { cookie } })).json();
    assert.equal(state.viewer.role, "spectator");
    assert.equal(db.count(), 0);
  } finally { app.close(); }
});

test("connexion : erreurs TLS, DNS et clé précises, sans exposer la clé", async () => {
  const run = promisify(execFile);
  const directory = fileURLToPath(new URL("./collecteurs/", import.meta.url));
  const python = `import sys,types
sys.dont_write_bytecode=True
sys.path.insert(0,sys.argv[1])
import tour_http as client
for code,body,expected in [(60,'','Certificat'),(6,'','DNS'),(0,'{}\\n401','Clé refusée'),(0,'<html>portal</html>\\n200','JSON')]:
 def fake(args,**kwargs):
  assert 'fake-secret' not in ' '.join(args)
  assert 'fake-secret' in kwargs['input']
  assert '--insecure' not in args and '-k' not in args
  return types.SimpleNamespace(returncode=code,stdout=body,stderr='fake-secret')
 client.subprocess.run=fake
 try:
  client.request('https://example.com','fake-secret','/api/connection')
  raise AssertionError('erreur attendue')
 except client.ConnectionError as error:
  assert expected in str(error), str(error)
  assert 'fake-secret' not in str(error)
`;
  await run("python3", ["-c", python, directory]);
});

test("ressources : gzip, revalidation 304 et API compressée sans cache public", async () => {
  const { app, url, call } = await open();
  try {
    const plain = await fetch(url + '/app.js', { headers: { 'Accept-Encoding': 'identity' } });
    const body = await plain.text(), etag = plain.headers.get('etag');
    assert.ok(etag);
    const cached = await fetch(url + '/app.js', { headers: { 'Accept-Encoding': 'identity', 'If-None-Match': etag } });
    assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
    const zipped = await fetch(url + '/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(zipped.headers.get('content-encoding'), 'gzip');
    assert.notEqual(zipped.headers.get('etag'), etag);
    assert.ok(Number(zipped.headers.get('content-length')) < Buffer.byteLength(body) / 2);
    assert.equal(await zipped.text(), body);
    assert.equal((await fetch(url + '/app.js', { headers: { 'Accept-Encoding': 'gzip;q=0' } })).headers.get('content-encoding'), null);
    const joined = await call('/api/join', { name: 'Compression', code: 'porte' }, { 'X-Forwarded-For': '4.4.4.4' });
    const cookie = joined.headers.get('set-cookie').split(';')[0], { token } = await joined.json();
    for (let i = 0; i < 4; i++) await call('/e?src=codex&host=test', { hook_event_name: 'UserPromptSubmit', session_id: 'test' + i, prompt: 'x'.repeat(2000) }, { 'X-Tour-Token': token });
    const state = await fetch(url + '/api/state', { headers: { cookie, 'Accept-Encoding': 'gzip' } });
    assert.equal(state.headers.get('content-encoding'), 'gzip');
    assert.equal(state.headers.get('cache-control'), 'no-store');
    assert.equal((await state.json()).apartments[0].name, 'Compression');
    assert.equal((await fetch(url + '/api/state')).status, 401);
  } finally { app.close(); }
});

test("géométries : boîtes et cylindres partagés avec dimensions propres", async () => {
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const snippet = source.slice(source.indexOf('const boxGeometry ='), source.indexOf('function textTexture'));
  let allocations = 0;
  class Geometry { constructor() { allocations++; } }
  class Mesh { constructor(geometry) { this.geometry = geometry; this.rotation = {}; this.position = { set() {} }; this.scale = { set: (...values) => { this.dimensions = values; } }; } }
  const context = { THREE: { BoxGeometry: Geometry, CylinderGeometry: Geometry, Mesh }, parent: { add() {} } };
  runInNewContext(snippet + '; globalThis.a = box(parent,2,3,4,null,0,0,0); globalThis.b = box(parent,5,6,7,null,0,0,0); globalThis.c = cyl(parent,2,4,null,0,0,0); globalThis.d = cyl(parent,3,8,null,0,0,0);', context);
  assert.equal(allocations, 2);
  assert.equal(context.a.geometry, context.b.geometry);
  assert.equal(context.c.geometry, context.d.geometry);
  assert.deepEqual(context.a.dimensions, [2,3,4]);
  assert.deepEqual(context.d.dimensions, [3,8,3]);
});

test("départ d’un agent : libère ses ressources sans détruire celles partagées", async () => {
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const snippet = source.slice(source.indexOf('  for (const [key, g] of agents) if (!want.has(key))'), source.indexOf('  // Écrans allumés aux postes'));
  let disposed = 0, bones = 0, stopped = 0, uncached = 0, removed = 0;
  const own = () => ({ dispose() { disposed++; } });
  const shared = { dispose() { throw new Error('ressource partagée détruite'); } };
  const root = {};
  const g = { children: [root], userData: { ring: { material: own() }, puffs: [{ material: own() }],
    mixer: { stopAllAction() { stopped++; }, uncacheRoot(value) { assert.equal(value, root); uncached++; } },
    bubble: { element: { remove() { removed++; } } } },
    traverse(fn) { fn({ userData: { tourMaterial: true }, material: own() }); fn({ userData: {}, material: shared, geometry: shared, isSkinnedMesh: true, skeleton: { dispose() { bones++; } } }); },
    remove() {}, parent: { remove() {} } };
  const agents = new Map([['gone', g]]);
  runInNewContext(snippet, { agents, want: new Map() });
  assert.equal(agents.size, 0); assert.equal(disposed, 3); assert.equal(bones, 1);
  assert.equal(stopped, 1); assert.equal(uncached, 1); assert.equal(removed, 1);
});

test("rendu : cadence plafonnée et travail suspendu en arrière-plan", async () => {
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const prefix = source.slice(source.indexOf('function animate(frameTime'), source.indexOf('  const dt = Math.min(clock.getDelta()', source.indexOf('function animate(frameTime')));
  const frames = [], document = { hidden: false }; let scheduled = 0, hiddenTicks = 0;
  const context = { frames, document, performance: { now: () => 0 }, clock: { getDelta() { hiddenTicks++; } }, requestAnimationFrame() { scheduled++; } };
  runInNewContext('let lastFrameAt = 0; ' + prefix + 'frames.push(frameTime); } animate(20); animate(25); animate(40);', context);
  assert.deepEqual(frames, [20, 40]);
  document.hidden = true;
  runInNewContext('animate(100);', context);
  assert.deepEqual(frames, [20, 40]); assert.equal(hiddenTicks, 1); assert.equal(scheduled, 4);
});

test("directs : les visiteurs concurrents partagent une seule mesure Twitch", async () => {
  const { app, url, call } = await open();
  const originalFetch = globalThis.fetch; let requests = 0;
  try {
    const joined = await call('/api/join', { name: 'Direct', code: 'porte' }, { 'X-Forwarded-For': '3.3.3.3' });
    const cookie = joined.headers.get('set-cookie').split(';')[0];
    globalThis.fetch = async (url, options) => {
      if (String(url).startsWith('https://www.twitch.tv/')) {
        requests++; await new Promise(resolve => setTimeout(resolve, 15));
        return { text: async () => '"isLiveBroadcast":true' };
      }
      return originalFetch(url, options);
    };
    const responses = await Promise.all(Array.from({ length: 3 }, () => fetch(url + '/api/live', { headers: { cookie } })));
    for (const response of responses) { assert.equal(response.status, 200); assert.equal(Object.keys(await response.json()).length, 8); }
    assert.equal(requests, 8, '8 chaînes une seule fois, au lieu de 24 requêtes');
  } finally { globalThis.fetch = originalFetch; app.close(); }
});


test("Grok : activité reçue, robot identifiable et diagnostic de connexion", () => {
  const store = createStore();
  ingest(store, "grok", "machine", { hook_event_name: "UserPromptSubmit", session_id: "grok-session", prompt: "Tâche Grok" }, 1000);
  assert.equal(snapshot(store, 1001).sessions[0].src, "grok");
  assert.equal(store.seen.machine.events.grok, 1000);
  ingest(store, "grok", "machine", { hook_event_name: "Stop", session_id: "grok-session" }, 1002);
  assert.equal(snapshot(store, 1003).sessions[0].state, "fini");
  assert.equal(snapshot(store, 1003).sessions.length, 1);
});

test("Grok Bot MCP : protocole, états réels reçus et clé refusée sans faux succès", async () => {
  const { app, db, url, call } = await open();
  const directory = mkdtempSync(join(tmpdir(), 'penthouse-grok-'));
  const bridge = join(directory, 'grok-mcp.py');
  const config = join(directory, 'grok-connection.json');
  const execute = messages => new Promise((resolve, reject) => {
    const child = execFile('python3', [bridge], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.end(messages.map(message => typeof message === 'string' ? message : JSON.stringify(message)).join('\n') + '\n');
  });
  try {
    const { token } = await (await call('/api/join', { name: 'Grok MCP', code: 'porte' }, { 'X-Forwarded-For': '2.2.2.2' })).json();
    for (const file of ['grok-mcp.py', 'tour_http.py']) writeFileSync(join(directory, file), readFileSync(new URL('./collecteurs/' + file, import.meta.url)));
    writeFileSync(config, JSON.stringify({ site: url, key: token }), { mode: 0o600 });
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ...['working', 'idle', 'approval', 'error', 'finished'].map((state, i) => ({ jsonrpc: '2.0', id: i + 3, method: 'tools/call', params: { name: 'penthouse_status', arguments: { bot: 'Grok test', session: 'same-task', state, project: 'demo' } } })),
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'penthouse_status', arguments: { bot: 'x', session: 'x', state: 'invented' } } },
      'broken-json',
    ];
    const output = await execute(messages), responses = output.trim().split('\n').map(JSON.parse);
    assert.ok(!output.includes(token));
    assert.equal(responses[0].result.protocolVersion, '2025-06-18');
    assert.equal(responses[1].result.tools[0].name, 'penthouse_status');
    assert.equal(responses.find(r => r.id === 8).result.isError, true);
    assert.equal(responses.at(-1).error.code, -32700);
    const store = db.get('grok-mcp').store;
    assert.equal(Object.keys(store.sessions).length, 1, 'même robot pendant tout le cycle');
    assert.equal(Object.values(store.sessions)[0].state, 'fini');
    assert.deepEqual(store.feed.map(event => event.state), ['travaille', 'attend', 'autorisation', 'erreur', 'fini']);
    writeFileSync(config, JSON.stringify({ site: url, key: 'wrong' }));
    const failed = JSON.parse((await execute([messages[3]])).trim());
    assert.equal(failed.result.isError, true);
    assert.equal(db.get('grok-mcp').store.feed.length, 5);
  } finally { app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("frigo : reste dans la pièce et affiche 40 canettes avec cinq photos fruitées", async () => {
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const editionsCode = source.slice(source.indexOf('const redBullEditions ='), source.indexOf('const redBullTextures ='));
  const block = source.slice(source.indexOf('  // Grand frigo vitré'), source.indexOf('  // Salon privé'));
  const boxes = [], instances = [];
  const position = () => ({ copy(v) { Object.assign(this, v); }, set(x,y,z) { Object.assign(this,{x,y,z}); } });
  class Node { constructor() { this.position = position(); this.children = []; } add(...nodes) { this.children.push(...nodes); } }
  class Instance extends Node { constructor(geometry, material, count) { super(); this.count=count; this.material=material; this.positions=[]; instances.push(this); } setMatrixAt(i,m) { this.positions[i]=[m.x,m.y,m.z]; } setColorAt() {} }
  class Matrix { makeTranslation(x,y,z) { Object.assign(this,{x,y,z}); return this; } }
  const textures = new Map(['Peach','Apricot','Red','SeaBlue','Blue'].map(name=>['redbull'+name,{}]));
  const g = new Node();
  runInNewContext(editionsCode + block, { g, redBullTextures: textures,
    THREE: { Group: Node, Mesh: Node, PlaneGeometry: class {}, MeshBasicMaterial: class { constructor(options) { Object.assign(this,options); } }, InstancedMesh: Instance, CylinderGeometry: class {}, Matrix4: Matrix, Color: class {} },
    P: (x,y)=>({x:x*0.02-10,y:0,z:y*0.02-6.2}), mat:()=>({}), glow:()=>({}), sign() {}, cyl() {},
    box(parent,w,h,d,material,x,y,z) { boxes.push({w,h,d,x,y,z}); },
  });
  const fridge = g.children[0];
  const right = Math.max(...boxes.map(b=>fridge.position.x+b.x+b.w/2));
  assert.ok(right < 9.54, 'aucune pièce du frigo dans la face intérieure de la cloison droite');
  const front = Math.max(...boxes.map(b=>fridge.position.z+b.z+b.d/2));
  assert.ok(front < -2.575, 'frigo en retrait du plateau du bureau');
  assert.equal(instances.filter(mesh=>mesh.count===8 && mesh.material.map).length,5);
  assert.equal(instances.filter(mesh=>mesh.count===8).reduce((n,mesh)=>n+mesh.positions.length,0),40);
  for (const name of ['Peach','Apricot','Red','SeaBlue','Blue']) {
    const png = readFileSync(new URL('./public/assets/redbull'+name+'.png', import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }
});

test("alerte rouge : seulement ses agents, une alerte par demande nouvelle", async () => {
  const { approvalState } = await import('./public/approval-alert.js');
  const session = { src: 'codex', host: 'mac', sid: 'a', state: 'autorisation', updated: 100 };
  const apartments = [{ slug: 'lucas', sessions: [session] }, { slug: 'paul', sessions: [{ ...session, sid: 'b' }] }];
  let state = approvalState(apartments, new Map(), 'lucas');
  assert.equal(state.pending.length, 1); assert.equal(state.fresh.length, 1);
  state = approvalState(apartments, state.current, 'lucas');
  assert.equal(state.fresh.length, 0, 'pas de flash répété toutes les deux secondes');
  session.updated = 101;
  state = approvalState(apartments, state.current, 'lucas'); assert.equal(state.fresh.length, 1);
  session.state = 'travaille';
  state = approvalState(apartments, state.current, 'lucas'); assert.equal(state.pending.length, 0);
  session.state = 'autorisation';
  assert.equal(approvalState(apartments, state.current, 'lucas').fresh.length, 1);
  assert.equal(approvalState(apartments, new Map(), null).pending.length, 0, 'pas d’alerte personnelle en spectateur');
});

test("pauses : choix variés, stables au polling, café puis Club conservés", async () => {
  const { breakVisit } = await import('./public/break-motion.js');
  for (let seed = 0; seed < 30; seed++) {
    assert.equal(breakVisit(seed, 0).place, 'cafe');
    assert.equal(breakVisit(seed, 299).place, 'cafe');
    assert.equal(breakVisit(seed, 300).place, 'club');
    assert.equal(breakVisit(seed, 899).place, 'club');
    assert.deepEqual(breakVisit(seed, 950), breakVisit(seed, 950));
    const visits = new Set();
    for (let age = 900; age < 2700; age += 2) visits.add(breakVisit(seed, age).place);
    assert.equal(visits.size, 8, "café, repos, tabac, toilettes, club, casino, tennis et golf");
  }
  assert.ok(new Set(Array.from({ length: 30 }, (_, seed) => breakVisit(seed, 1000).place)).size > 3);
});

test("pauses : réservation des places, pas de doublons et trajet en cours respecté", async () => {
  const { assignPauseSlots } = await import('./public/break-motion.js');
  const previous = new Map([['a', { index: 3, visit: 1 }], ['b', { index: 0, visit: 2 }]]);
  let entries = [{ key: 'a', seed: 2, visit: 2, moving: true }, { key: 'b', seed: 5, visit: 2 }, { key: 'c', seed: 9, visit: 2 }];
  let slots = assignPauseSlots(entries, previous, 4);
  assert.equal(slots.get('a'), 3); assert.equal(slots.get('b'), 0);
  assert.equal(new Set(slots.values()).size, 3);
  previous.set('c', { index: slots.get('c'), visit: 2 });
  entries[0].moving = false;
  slots = assignPauseSlots(entries, previous, 4);
  assert.notEqual(slots.get('a'), 3);
  assert.equal(slots.get('b'), 0); assert.equal(slots.get('c'), previous.get('c').index);
  const many = assignPauseSlots(Array.from({ length: 30 }, (_, i) => ({ key: String(i), seed: i, visit: 1 })), new Map(), 9);
  assert.equal(new Set(many.values()).size, 30);
});

test("pauses : travail, attente et autorisation restent prioritaires", async () => {
  const { runInNewContext } = await import('node:vm');
  const { breakVisit } = await import('./public/break-motion.js');
  const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function placeOf('), source.indexOf('// ---------- moteur'));
  const context = { breakVisit, hash: () => 12, stateOf: s => s.state, s: { src: 'codex', host: 'test', sid: 's', updated: 0 } };
  for (const [state, expected] of [['travaille','open'], ['autorisation','boss'], ['attend','smoke'], ['erreur','open']]) {
    context.s.state = state;
    assert.equal(runInNewContext(fn + '; placeOf(s, 2000)', context), expected);
  }
});


test("quotas : une mesure vide ou partielle conserve les dernières fenêtres valides", () => {
  const store = createStore();
  const send = usage => ingest(store, 'usage', 'test', { hook_event_name: 'usage', usage: { chatgpt: usage } }, 100);
  send({ ts: 10, five_hour: { pct: 20 }, seven_day: { pct: 30 } });
  send({ ts: 20, five_hour: null, seven_day: null });
  assert.equal(store.usage.chatgpt.ts, 10);
  assert.equal(store.usage.chatgpt.seven_day.pct, 30);
  send({ ts: 30, five_hour: { pct: 25 }, seven_day: null });
  assert.equal(store.usage.chatgpt.five_hour.pct, 25);
  assert.equal(store.usage.chatgpt.seven_day.pct, 30);
  send({ ts: 15, seven_day: { pct: 99 } });
  assert.equal(store.usage.chatgpt.seven_day.pct, 30);
});

test("collecteur : quotas valides conservés après événements Codex sans limites", async () => {
  const run = promisify(execFile);
  const path = fileURLToPath(new URL('./collecteurs/tour-sync', import.meta.url));
  const python = `import runpy,sys,json
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
parse=runpy.run_path(sys.argv[1])['parse']
def event(t,limits): return json.dumps({'type':'event_msg','timestamp':'2026-11-03T00:00:0'+str(t)+'Z','payload':{'type':'token_count','rate_limits':limits}})
p=parse('codex',[event(1,{'primary':{'used_percent':20},'secondary':{'used_percent':30}}),event(2,{'primary':None,'secondary':None}),event(3,{'primary':{'used_percent':25},'secondary':None})])
assert p['usage']['chatgpt']['five_hour']['pct']==25
assert p['usage']['chatgpt']['seven_day']['pct']==30
assert 'usage' not in parse('codex',[event(1,{'primary':None,'secondary':None})])
`;
  await run('python3', ['-c', python, path]);
});

test("profil étage : enregistrement avec clé et exposition dans l'état", async () => {
  const { app, url, call } = await open();
  try {
    const join = await call("/api/join", { name: "Styler", code: "porte" }, { "X-Forwarded-For": "10.0.0.42" });
    assert.equal(join.status, 200);
    const { slug, token } = await join.json();
    const cookieHeader = join.headers.getSetCookie?.()?.[0] ?? join.headers.get("set-cookie");
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(";")[0];
    assert.equal((await call("/api/profile", { profile: { accent: "#112233", tagline: "Nuit code" } }, { "X-Tour-Token": token })).status, 401);
    const saved = await (await call("/api/profile", { profile: { accent: "#112233", tagline: "Nuit code" } }, { Cookie: cookie, "X-Tour-Token": token })).json();
    assert.equal(saved.profile.tagline, "Nuit code");
    assert.equal(sanitizeProfile({ accent: "bad", tagline: "x".repeat(200) }).accent, "#e8c27a");
    assert.equal(sanitizeProfile({ accent: "bad", tagline: "x".repeat(200) }).tagline.length, 80);
    const state = await (await fetch(url + "/api/state", { headers: { cookie } })).json();
    assert.equal(state.apartments.find(a => a.slug === slug).profile.accent, "#112233");
  } finally {
    app.close();
  }
});

test("Cursor : sessions et signe de vie machine", () => {
  const store = createStore();
  ingest(store, "cursor", "macbook", { hook_event_name: "cursor:working", session_id: "cur-1", prompt: "refactor" }, 10);
  const view = snapshot(store, 11);
  assert.equal(view.sessions[0].state, "travaille");
  assert.equal(view.sessions[0].task, "refactor");
  assert.equal(store.seen.macbook.events.cursor, 10);
  ingest(store, "cursor", "macbook", { hook_event_name: "cursor:approval", session_id: "cur-1" }, 12);
  assert.equal(snapshot(store, 13).sessions[0].state, "autorisation");
});

test("gamification : activité commune et quête", async () => {
  const { app, call } = await open();
  try {
    const join = await call("/api/join", { name: "Joueur", code: "porte" }, { "X-Forwarded-For": "10.0.0.50" });
    const { token } = await join.json();
    const cookieHeader = join.headers.getSetCookie?.()?.[0] ?? join.headers.get("set-cookie");
    const cookie = cookieHeader.split(";")[0];
    const action = await call("/api/game/action", { action: "roof_breathe", floor: "roof", agentsHere: 0 }, { Cookie: cookie, "X-Tour-Token": token });
    assert.equal(action.status, 200);
    const body = await action.json();
    assert.ok(body.game.xp >= 30);
    assert.ok(body.toasts.length >= 1);
    const again = await call("/api/game/action", { action: "roof_breathe", floor: "lounge", agentsHere: 0 }, { Cookie: cookie, "X-Tour-Token": token });
    assert.equal(again.status, 400);
  } finally {
    app.close();
  }
});

test("aménagement bureau lié au niveau XP", () => {
  assert.equal(officeTierForLevel(1).name, "Starter");
  assert.equal(officeTierForLevel(3).id, 2);
  assert.ok(officeTierForLevel(6).bookcase);
  const pub = officePublic(5);
  assert.equal(pub.name, "Confort");
  assert.equal(pub.next.name, "Pro");
  assert.equal(officePublic(15).next, null);
});

test("flux SSE : premier paquet d'état pour un résident", async () => {
  const { app, url, call } = await open();
  try {
    const join = await call("/api/join", { name: "Stream", code: "porte" }, { "X-Forwarded-For": "10.0.0.43" });
    assert.equal(join.status, 200);
    const cookieHeader = join.headers.getSetCookie?.()?.[0] ?? join.headers.get("set-cookie");
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(";")[0];
    const res = await fetch(url + "/api/stream", { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes("data: ")) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
    }
    reader.cancel().catch(() => {});
    const line = buffer.split("\n").find(row => row.startsWith("data: "));
    assert.ok(line);
    const payload = JSON.parse(line.slice(6));
    assert.ok(Array.isArray(payload.apartments));
    assert.equal(payload.viewer.role, "resident");
  } finally {
    app.close();
  }
});

// ---------- Corrections de novembre 2026 : site qui charge, serveur qui tient, jeu sans triche ----------

test("client : chaque module importé par la page est servi (sinon la page entière reste vide)", async () => {
  const { app, url } = await open();
  try {
    const { readdirSync } = await import("node:fs");
    const publicDir = new URL("./public/", import.meta.url);
    const wanted = new Set();
    const html = readFileSync(new URL("index.html", publicDir), "utf8");
    for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) wanted.add("/" + src.replace(/^\.?\//, ""));
    for (const [, href] of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"h][^"]*)"/g)) wanted.add("/" + href.replace(/^\.?\//, ""));
    for (const file of readdirSync(publicDir).filter(f => f.endsWith(".js"))) {
      const source = readFileSync(new URL(file, publicDir), "utf8");
      for (const [, path] of source.matchAll(/^\s*import\b[^"']*["'](\.\/[^"']+)["']/gm)) wanted.add(path.slice(1));
      for (const [, path] of source.matchAll(/\bimport\(\s*["'](\.\/[^"']+)["']\s*\)/g)) wanted.add(path.slice(1));
    }
    assert.ok(wanted.has("/wings-client.js") && wanted.has("/app.js"));
    for (const path of wanted) assert.equal((await fetch(url + path)).status, 200, `${path} doit être servi`);
  } finally { app.close(); }
});

test("collecte : un événement mal formé est refusé sans arrêter le serveur", async () => {
  const { app, url, call } = await open();
  try {
    const { token } = await (await call("/api/join", { name: "Robuste", code: "porte" }, { "X-Forwarded-For": "10.1.0.1" })).json();
    const post = body => fetch(url + "/e?src=claude&host=mac", { method: "POST", body: JSON.stringify(body), headers: { "X-Tour-Token": token } });
    for (const body of [
      { hook_event_name: "Stop", session_id: "a", cwd: 123 },
      { hook_event_name: "PreToolUse", session_id: "b", tool_name: 42, tool_input: { command: ["x"] } },
      { hook_event_name: "PermissionRequest", session_id: "c", tool_name: { x: 1 } },
      { hook_event_name: "UserPromptSubmit", session_id: "d", prompt: { long: "x" }, usage: "n'importe quoi", info: [1, 2] },
      { hook_event_name: "health", health: { services: "x".repeat(20000) } },
    ]) assert.ok([204, 400].includes((await post(body)).status));
    // Le serveur répond toujours, et l'étage garde des données propres.
    const state = await fetch(url + "/api/connection", { headers: { "X-Tour-Token": token } });
    assert.equal(state.status, 200);
  } finally { app.close(); }
});

test("collecte : machines et objets libres bornés", () => {
  const store = createStore();
  for (let i = 0; i < 40; i++) ingest(store, "claude", "m" + i, { hook_event_name: "Stop", session_id: "s" + i, info: { big: "x".repeat(i === 3 ? 5000 : 10) } }, 1000 + i);
  assert.equal(Object.keys(store.seen).length, 24);
  assert.ok(store.seen.m39 && !store.seen.m0);
  ingest(store, "claude", "vieux", { hook_event_name: "Stop", session_id: "v" }, 1000);
  ingest(store, "claude", "neuf", { hook_event_name: "Stop", session_id: "n" }, 1000 + 31 * 86400);
  assert.equal(store.seen.vieux, undefined);
  ingest(store, "codex", "neuf", { hook_event_name: "usage", usage: { chatgpt: { ts: 5, plan: "pro", five_hour: { pct: 12, resets_at: 99, secret: "x" }, extra: "y".repeat(1000) } } }, 1000 + 31 * 86400);
  assert.deepEqual(store.usage.chatgpt, { plan: "pro", five_hour: { pct: 12, resets_at: 99 }, ts: 5 });
});

test("jeu : ailes inventées, verrouillées ou d'un autre étage ne rapportent rien", async () => {
  const { visitWing, performSpaceAction } = await import("./gamify.js");
  const store = createStore(), now = Date.UTC(2026, 10, 4, 12) / 1000;
  for (let i = 0; i < 20; i++) visitWing(store, "moi:fake" + i, now, "moi");
  visitWing(store, "moi:studio", now, "moi");
  assert.equal(store.game.xp, 0);
  assert.ok(performSpaceAction(store, "studio_focus", now, { floor: "moi:studio", slug: "moi" }).error);
  assert.ok(performSpaceAction(store, "roof_breathe", now, {}).error, "l'étage est obligatoire");
  assert.ok(performSpaceAction(store, "club_dance", now, { floor: "club", agentsHere: 99 }).error, "le serveur compte lui-même les agents en pause");
  store.game.xp = 10_000; // niveau 12 : toutes les ailes
  assert.equal(visitWing(store, "autre:lab", now, "moi").skipped, true);
  const visit = visitWing(store, "moi:lab", now, "moi");
  assert.equal(visit.skipped, undefined);
  assert.equal(store.game.xp, 10_012);
  assert.equal(visitWing(store, "moi:lab", now, "moi").skipped, true, "une fois par jour");
  assert.ok(performSpaceAction(store, "studio_focus", now, { floor: "moi:studio", slug: "moi" }).ok);
});

test("jeu : la série de jours suit l'activité réelle, pas les visites du site", async () => {
  const { onIngestGame } = await import("./gamify.js");
  const store = createStore(), day = Date.UTC(2026, 10, 1, 12) / 1000;
  for (let d = 0; d < 5; d++) snapshot(store, day + d * 86400);
  assert.equal(snapshot(store, day + 5 * 86400).game.streak, 0);
  for (let d = 10; d < 13; d++) {
    const prev = Object.fromEntries(Object.entries(store.sessions).map(([k, s]) => [k, { state: s.state, updated: s.updated }]));
    ingest(store, "claude", "mac", { hook_event_name: "UserPromptSubmit", session_id: "s" + d }, day + d * 86400);
    onIngestGame(store, prev, {}, day + d * 86400);
  }
  assert.equal(snapshot(store, day + 12 * 86400).game.streak, 3);
  assert.equal(snapshot(store, day + 14 * 86400).game.streak, 0, "un jour sans activité casse la série");
});

test("jeu : les toasts d'une visite d'aile arrivent au client", async () => {
  const { app, call, db } = await open();
  try {
    const join = await call("/api/join", { name: "Visiteur", code: "porte" }, { "X-Forwarded-For": "10.1.0.2" });
    const { token } = await join.json(), cookie = join.headers.get("set-cookie").split(";")[0];
    db.change("visiteur", store => { store.game.xp = 2000; });
    const r = await call("/api/game/visit", { floor: "visiteur:lab" }, { Cookie: cookie, "X-Tour-Token": token });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.ok(body.toasts.some(t => t.title === "Aile · Labo IA"));
  } finally { app.close(); }
});

test("télé : lien perso YouTube/Twitch normalisé, toute autre adresse refusée", async () => {
  const { parseTvLink } = await import("./penthouse.js");
  assert.deepEqual(parseTvLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), { kind: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseTvLink("https://youtu.be/dQw4w9WgXcQ"), { kind: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseTvLink("https://www.youtube.com/live/jfKfPfyJRdk"), { kind: "youtube", id: "jfKfPfyJRdk" });
  assert.deepEqual(parseTvLink("https://www.twitch.tv/Zerator"), { kind: "twitch", channel: "zerator" });
  for (const bad of ["javascript:alert(1)", "https://evil.example/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=<script>", "data:text/html,x", "https://www.twitch.tv/directory", ""]) assert.equal(parseTvLink(bad), null, bad);
  const { app, call } = await open();
  try {
    const join = await call("/api/join", { name: "Teleur", code: "porte" }, { "X-Forwarded-For": "10.1.0.3" });
    const { token } = await join.json(), cookie = join.headers.get("set-cookie").split(";")[0];
    const ok = await call("/api/tv", { channel: "custom", url: "https://youtu.be/dQw4w9WgXcQ", by: "Quelqu'un d'autre" }, { Cookie: cookie, "X-Tour-Token": token });
    assert.deepEqual((({ channel, custom, by }) => ({ channel, custom, by }))(await ok.json()), { channel: "custom", custom: { kind: "youtube", id: "dQw4w9WgXcQ" }, by: "Teleur" });
    assert.equal((await call("/api/tv", { channel: "custom", url: "javascript:alert(1)" }, { Cookie: cookie })).status, 400);
  } finally { app.close(); }
});

test("historique CSV : les formules de tableur sont neutralisées", async () => {
  const { historyCsv } = await import("./public/penthouse-extras.js");
  const csv = historyCsv({ sessions: [{ updated: 1, src: "claude", project: "=HYPERLINK(\"x\")", state: "fini", action: "+cmd" }], feed: [] });
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"'\+cmd"/);
});

test("limite d'essais : X-Forwarded-For ignoré quand le serveur est exposé directement", async () => {
  process.env.TRUST_PROXY = "0";
  const { app, call } = await open();
  try {
    let last;
    for (let i = 0; i < 12; i++) last = await call("/api/join", { name: "x", code: "faux" }, { "X-Forwarded-For": "9.9.9." + i });
    assert.equal(last.status, 429);
  } finally { delete process.env.TRUST_PROXY; app.close(); }
});

// ---------- Économie : rôles selon l'abonnement, salaires, carrière, boutique, casino, primes ----------

// Journée calme d'un lundi (2026-11-02), 10 h à Paris : aucun événement ni majoration ne fausse les calculs.
const CALM_MORNING = Date.UTC(2026, 10, 2, 9) / 1000;
// Fait travailler une session : un signe de vie toutes les 2 minutes pendant `minutes`.
async function workSession(store, src, sid, start, minutes, extra = {}) {
  const { onIngestEconomy } = await import("./economy.js");
  const step = (p, t) => {
    const prev = Object.fromEntries(Object.entries(store.sessions).map(([k, s]) => [k, { state: s.state, updated: s.updated }]));
    ingest(store, src, "mac", { session_id: sid, ...extra, ...p }, t);
    onIngestEconomy(store, prev, t);
  };
  step({ hook_event_name: "UserPromptSubmit", prompt: "go" }, start);
  for (let m = 2; m <= minutes; m += 2) step({ hook_event_name: "PreToolUse", tool_name: "Bash" }, start + m * 60);
  return step;
}

test("économie : le grade suit l'abonnement, le salaire suit le temps de travail réel", async () => {
  const { setSubscription, publicEconomy } = await import("./economy.js");
  const store = createStore();
  assert.equal(publicEconomy(store, CALM_MORNING).staff.length, 0);
  assert.ok(setSubscription(store, "claude", "max20", CALM_MORNING).ok);
  await workSession(store, "claude", "c1", CALM_MORNING, 60);
  const claude = publicEconomy(store, CALM_MORNING + 3600).staff.find(s => s.src === "claude");
  assert.equal(claude.grade.id, "lead");
  assert.equal(claude.role, "🧭 Lead · Ingé logiciel");
  assert.equal(claude.todayMinutes, 60);
  assert.equal(claude.todayPay, 120, "1 h à 120 P$/h");
  assert.equal(store.economy.wallet, 120);
  // Sans abonnement déclaré, Codex est stagiaire : 1 h à 15 P$/h.
  await workSession(store, "codex", "x1", CALM_MORNING, 60);
  assert.equal(publicEconomy(store, CALM_MORNING + 3600).staff.find(s => s.src === "codex").todayPay, 15);
  // Un outil inconnu n'est pas un employé.
  await workSession(store, "pirate", "p1", CALM_MORNING, 60);
  assert.equal(store.economy.wallet, 135);
  assert.ok(store.game.badges.includes("first_pay"));
});

test("économie : heures sup majorées, repos obligatoire après 10 h, gros trous non payés", async () => {
  const { setSubscription, publicEconomy } = await import("./economy.js");
  const store = createStore();
  const start = CALM_MORNING - 3 * 3600; // 7 h à Paris : la journée finit à 18 h, sans majoration de nuit
  setSubscription(store, "claude", "pro", start); // Junior, 30 P$/h
  store.economy.perks.cafe_premium = CALM_MORNING + 86400; // moral au max : seul le temps compte ici
  const step = await workSession(store, "claude", "c1", start, 11 * 60);
  const day = publicEconomy(store, start + 11 * 3600).staff[0];
  assert.equal(day.todayMinutes, 660);
  assert.ok(day.overtime && day.resting);
  // 2 h à 30, 4 h à 31,80 (échelon 2), 1 h à 33,60 (échelon 3), 3 h sup à 33,60 × 1,25, la 11e heure non payée.
  assert.equal(day.todayPay, money2(60 + 127.2 + 33.6 + 126));
  const paid = store.economy.wallet;
  step({ hook_event_name: "PreToolUse", tool_name: "Bash" }, start + 11 * 3600 + 120);
  assert.equal(store.economy.wallet, paid, "au-delà de 10 h, plus rien");
  // Un trou de 2 h entre deux événements ne compte que pour 10 minutes.
  const other = createStore();
  const stepOther = await workSession(other, "claude", "c2", CALM_MORNING, 0);
  stepOther({ hook_event_name: "PreToolUse", tool_name: "Bash" }, CALM_MORNING + 7200);
  assert.equal(other.economy.day.minutes.claude, 10);
});

test("économie : majorations de nuit et du dimanche, moral qui baisse sans pause", async () => {
  const { rateFor, setSubscription } = await import("./economy.js");
  const store = createStore();
  setSubscription(store, "claude", "pro", CALM_MORNING);
  assert.equal(rateFor(store, "claude", CALM_MORNING).rate, 30);
  assert.equal(rateFor(store, "claude", Date.UTC(2026, 10, 2, 22) / 1000).rate, 37.5, "23 h à Paris : +25 %");
  assert.equal(rateFor(store, "claude", Date.UTC(2026, 10, 15, 10) / 1000).rate, 45, "dimanche : +50 %");
  store.economy.staff.claude = { minutes: 0, cont: 300, lastWork: CALM_MORNING, model: "claude-opus-4" };
  const tired = rateFor(store, "claude", CALM_MORNING);
  assert.equal(tired.morale, 40);
  assert.ok(tired.factors.some(f => f.label === "Prime modèle haut de gamme"));
  assert.equal(tired.rate, money2(30 * 1.15 * 0.82));
  assert.equal(rateFor(store, "claude", CALM_MORNING + 20 * 60).morale, 100, "une pause de 15 min remet le moral à 100");
});
const money2 = x => Math.round(x * 100) / 100;

test("économie : formule ChatGPT vérifiée par Codex, montée en gamme limitée, descente libre", async () => {
  const { setSubscription, publicEconomy } = await import("./economy.js");
  const store = createStore();
  assert.ok(setSubscription(store, "chatgpt", "plus", CALM_MORNING).ok);
  assert.match(setSubscription(store, "chatgpt", "pro", CALM_MORNING + 60).error, /6 h/);
  assert.ok(setSubscription(store, "chatgpt", "free", CALM_MORNING + 120).ok, "descendre est toujours permis");
  assert.ok(setSubscription(store, "chatgpt", "pro", CALM_MORNING + 7 * 3600).ok);
  assert.ok(setSubscription(store, "inconnu", "pro", CALM_MORNING).error);
  assert.ok(setSubscription(store, "claude", "max999", CALM_MORNING).error);
  // Les journaux Codex disent « plus » : c'est la formule retenue, marquée vérifiée.
  ingest(store, "codex", "mac", { hook_event_name: "Stop", session_id: "x", usage: { chatgpt: { ts: 1, plan: "plus", five_hour: { pct: 3 } } } }, CALM_MORNING);
  const codex = publicEconomy(store, CALM_MORNING + 7 * 3600).staff.find(s => s.src === "codex");
  assert.deepEqual([codex.tier.id, codex.verified, codex.grade.id], ["plus", true, "junior"]);
});

test("économie : ancienneté, promotion d'échelon, primes de livraison et de réactivité", async () => {
  const { onIngestEconomy, publicEconomy } = await import("./economy.js");
  const store = createStore();
  const step = await workSession(store, "claude", "c1", CALM_MORNING, 120);
  let claude = publicEconomy(store, CALM_MORNING + 7200).staff[0];
  assert.equal(claude.echelon, 2);
  assert.equal(claude.nextEchelon, 240);
  assert.ok(store.economy.ledger.some(e => e.kind === "promo"));
  assert.ok(store.game.badges.includes("promo"));
  const before = store.economy.wallet;
  step({ hook_event_name: "Stop" }, CALM_MORNING + 7300);
  // 100 s de travail à 15,90 P$/h (stagiaire, échelon 2) puis la prime de livraison d'un stagiaire : 4 P$.
  assert.equal(money2(store.economy.wallet - before), money2(0.44 + 4));
  step({ hook_event_name: "PermissionRequest", tool_name: "Bash" }, CALM_MORNING + 7400);
  const mid = store.economy.wallet;
  step({ hook_event_name: "PreToolUse", tool_name: "Bash" }, CALM_MORNING + 7460);
  assert.equal(money2(store.economy.wallet - mid), 12, "accord donné en 1 min");
  assert.equal(publicEconomy(store, CALM_MORNING + 7500).today.reactivity, 1);
  void onIngestEconomy;
});

test("économie : boutique, Black Friday, décor, formation et séminaire", async () => {
  const { buyItem, publicEconomy } = await import("./economy.js");
  const store = createStore();
  assert.match(buyItem(store, "arcade", null, CALM_MORNING).error, /Solde insuffisant/);
  store.economy.wallet = 5000;
  assert.ok(buyItem(store, "arcade", null, CALM_MORNING).ok);
  assert.equal(store.economy.wallet, 4100);
  assert.match(buyItem(store, "arcade", null, CALM_MORNING).error, /Déjà/);
  const blackFriday = Date.UTC(2026, 10, 28, 10) / 1000;
  assert.equal(publicEconomy(store, blackFriday).shopFactor, 0.7);
  assert.ok(buyItem(store, "aquarium", null, blackFriday).ok);
  assert.equal(store.economy.wallet, 4100 - 1050);
  assert.ok(buyItem(store, "plante_xl", null, blackFriday).ok);
  assert.ok(store.game.badges.includes("decorator"));
  assert.deepEqual(publicEconomy(store, blackFriday).decor, ["arcade", "aquarium", "plante_xl"]);
  assert.match(buyItem(store, "formation", "nimporte", blackFriday).error, /agent/);
  assert.ok(buyItem(store, "formation", "claude", blackFriday).ok);
  assert.equal(publicEconomy(store, blackFriday).staff.find(s => s.src === "claude").echelon, 2);
  const xp = store.game.xp;
  assert.ok(buyItem(store, "seminaire", null, blackFriday).ok);
  assert.equal(store.game.xp, xp + 150);
  assert.ok(buyItem(store, "objectifs", null, blackFriday).ok);
  assert.ok(publicEconomy(store, blackFriday).perks.objectifs > blackFriday);
  assert.equal(buyItem(store, "inexistant", null, blackFriday).error, "Article inconnu.");
});

test("casino : tirages du serveur, gains, limites et assurance", async () => {
  const { playCasino, slotsMultiplier } = await import("./economy.js");
  const { CASINO, EVENTS } = await import("./public/economy-data.js");
  // Retour moyen de la machine à sous, calculé exactement : la maison gagne, même un jour de jackpot.
  const symbols = CASINO.slots.symbols, total = symbols.reduce((n, s) => n + s.w, 0);
  const rtp = event => symbols.flatMap(a => symbols.flatMap(b => symbols.map(c => [a, b, c])))
    .reduce((n, r) => n + r.reduce((p, s) => p * s.w / total, 1) * slotsMultiplier(r.map(s => s.s), event), 0);
  assert.ok(rtp({}) > 0.9 && rtp({}) < 0.96, `retour ${rtp({})}`);
  assert.ok(rtp(EVENTS.find(e => e.jackpot)) < 1);
  const store = createStore();
  store.economy.wallet = 1000;
  const fixed = values => { let i = 0; return () => values[i++ % values.length]; };
  // Rouleaux 7️⃣ 7️⃣ 7️⃣ (tirage 99 sur 100), jour calme : × 50.
  const jackpot = playCasino(store, "slots", 100, "", CALM_MORNING, fixed([99, 99, 99]));
  assert.deepEqual(jackpot.result, { reels: ["7️⃣", "7️⃣", "7️⃣"], win: 5000, net: 4900 });
  assert.equal(store.economy.wallet, 5900);
  assert.ok(store.game.badges.includes("jackpot"));
  assert.equal(store.economy.records.jackpots, 1);
  const pair = playCasino(store, "slots", 10, "", CALM_MORNING, fixed([0, 0, 60]));
  assert.deepEqual([pair.result.reels.join(""), pair.result.win], ["🍒🍒🔔", 15]);
  assert.equal(playCasino(store, "roulette", 10, "rouge", CALM_MORNING, fixed([1])).result.win, 20);
  assert.equal(playCasino(store, "roulette", 10, "pair", CALM_MORNING, fixed([0])).result.win, 0, "le zéro n'est pas pair");
  assert.equal(playCasino(store, "roulette", 10, "17", CALM_MORNING, fixed([17])).result.win, 360);
  assert.match(playCasino(store, "roulette", 10, "bleu", CALM_MORNING).error, /rouge/);
  const race = playCasino(store, "race", 100, "claude", CALM_MORNING, fixed([0, 0, 0, 0, 0]));
  assert.equal(race.result.order.length, 6);
  assert.equal(race.result.win, race.result.winner === "claude" ? 550 : 0);
  assert.match(playCasino(store, "slots", 5, "", CALM_MORNING).error, /Mise/);
  assert.match(playCasino(store, "slots", 501, "", CALM_MORNING).error, /Mise/);
  assert.match(playCasino(store, "poker", 10, "", CALM_MORNING).error, /inconnu/);
  // Assurance : la moitié de la prochaine perte revient.
  store.economy.perks.assurance = true;
  const before = store.economy.wallet;
  playCasino(store, "roulette", 400, "0", CALM_MORNING, fixed([5]));
  assert.equal(store.economy.wallet, before - 200);
  assert.equal(store.economy.perks.assurance, undefined);
  // Limite de pertes du jour.
  const broke = createStore();
  broke.economy.wallet = 10_000;
  for (let i = 0; i < 4; i++) playCasino(broke, "roulette", 500, "0", CALM_MORNING, fixed([5]));
  assert.match(playCasino(broke, "roulette", 10, "0", CALM_MORNING, fixed([5])).error, /pertes/);
  const poor = createStore();
  assert.match(playCasino(poor, "slots", 10, "", CALM_MORNING).error, /Solde/);
});

test("économie par HTTP : abonnement, casino, primes entre résidents, missions payées, vue spectateur", async () => {
  const { app, url, call, db } = await open();
  try {
    const enter = async (name, ip) => {
      const join = await call("/api/join", { name, code: "porte" }, { "X-Forwarded-For": ip });
      const { token } = await join.json();
      return { token, headers: { Cookie: join.headers.get("set-cookie").split(";")[0], "X-Tour-Token": token } };
    };
    const ana = await enter("Ana", "10.2.0.1"), bob = await enter("Bob", "10.2.0.2");
    assert.equal((await call("/api/economy/subscription", { provider: "claude", tier: "max5" }, { Cookie: ana.headers.Cookie })).status, 403);
    const sub = await (await call("/api/economy/subscription", { provider: "claude", tier: "max5" }, ana.headers)).json();
    assert.equal(sub.economy.subs.claude, "max5");
    assert.ok(sub.toasts.some(t => /Senior/.test(t.body)));
    db.change("ana", store => { store.economy.wallet = 600; });
    const slots = await call("/api/economy/casino", { game: "slots", bet: 10 }, ana.headers);
    assert.equal(slots.status, 200);
    assert.equal((await slots.json()).result.reels.length, 3);
    const sent = await call("/api/economy/tip", { to: "Bob", amount: 100, message: "Merci pour la revue !" }, ana.headers);
    assert.equal(sent.status, 200);
    assert.equal(db.get("bob").store.economy.wallet, 100);
    assert.equal(db.get("bob").store.economy.ledger[0].label, "Prime de Ana · Merci pour la revue !");
    assert.equal((await call("/api/economy/tip", { to: "ana", amount: 10 }, ana.headers)).status, 400);
    assert.equal((await call("/api/economy/tip", { to: "personne", amount: 10 }, ana.headers)).status, 400);
    assert.match((await (await call("/api/economy/tip", { to: "bob", amount: 950 }, ana.headers)).json()).error, /Plafond|Solde/);
    // Mission du jour : récompense en XP et en P$.
    const now = Date.now() / 1000;
    db.change("bob", store => { store.economy.day = null; });
    const ev = (body, t) => fetch(`${url}/e?src=claude&host=mac`, { method: "POST", body: JSON.stringify(body), headers: { "X-Tour-Token": bob.token } });
    for (const sid of ["a", "b", "c"]) await ev({ hook_event_name: "SessionStart", session_id: sid }, now);
    const claim = await (await call("/api/game/claim", { questId: "sessions" }, bob.headers)).json();
    assert.ok(claim.game.xp >= 80);
    assert.ok(db.get("bob").store.economy.ledger.some(e => e.kind === "quest" && e.amount === 80));
    // Spectateur : réussite visible, comptes et relevé absents.
    const room = await call("/api/spectate", { room: "Penthouse" }, { "X-Forwarded-For": "10.2.0.3" });
    const spectator = room.headers.get("set-cookie").split(";")[0];
    const state = await (await fetch(url + "/api/state", { headers: { Cookie: spectator } })).json();
    const view = state.apartments.find(a => a.slug === "ana").economy;
    assert.deepEqual(Object.keys(view).sort(), ["decor", "earned", "records", "staff", "title", "today", "wallet"]);
    assert.deepEqual(Object.keys(view.staff[0]).sort(), ["echelon", "grade", "role", "src"]);
    assert.equal((await call("/api/economy/casino", { game: "slots", bet: 10 }, { Cookie: spectator, "X-Tour-Token": ana.token })).status, 401);
  } finally { app.close(); }
});

// ---------- Blackjack, tennis, golf, jackpot commun ----------

test("blackjack : distribution, tirer, rester, doubler, blackjack naturel", async () => {
  const { playCasino, handTotal, publicEconomy } = await import("./economy.js");
  assert.equal(handTotal(["A♠", "K♥"]), 21);
  assert.equal(handTotal(["A♠", "A♥", "9♦"]), 21);
  assert.equal(handTotal(["K♠", "Q♥", "5♦"]), 25);
  const store = createStore();
  store.economy.wallet = 1000;
  const bj = (action, bet) => playCasino(store, "blackjack", bet, "", CALM_MORNING, undefined, { action });
  assert.match(bj("hit").error, /Aucune main/);
  const deal = bj("deal", 100);
  assert.ok(deal.ok);
  if (deal.result.hand.status === "playing") {
    assert.equal(deal.result.hand.dealer[1], "??", "carte cachée de la banque");
    assert.equal(publicEconomy(store, CALM_MORNING).blackjack.dealer[1], "??");
    assert.equal(store.economy.wallet, 900, "mise débitée à la distribution");
    assert.match(bj("deal", 100).error, /Termine/);
    const end = bj("stand");
    assert.ok(["win", "lose", "push"].includes(end.result.hand.status));
    assert.ok(!end.result.hand.dealer.includes("??"));
    assert.ok(end.result.hand.dealerTotal >= 17);
  }
  assert.equal(store.economy.blackjack, null);
  // Mains préparées : on contrôle le sabot (on tire par la fin).
  const preset = (player, dealer, deck, bet = 100) => {
    store.economy.wallet = 1000 - bet;
    store.economy.blackjack = { bet, player, dealer, deck };
  };
  preset(["10♠", "6♥"], ["9♦", "7♣"], ["2♠", "5♥"]);
  assert.deepEqual([bj("hit").result.hand.playerTotal, store.economy.wallet], [21, 1100], "21 : la banque joue (16 + 2 = 18), gagné × 2");
  preset(["10♠", "6♥"], ["9♦", "8♣"], ["K♠"]);
  assert.equal(bj("hit").result.hand.status, "bust");
  assert.equal(store.economy.wallet, 900);
  preset(["5♠", "6♥"], ["10♦", "7♣"], ["K♠"]);
  const doubled = bj("double");
  assert.deepEqual([doubled.result.hand.status, doubled.result.hand.bet, doubled.result.win], ["win", 200, 400]);
  assert.equal(store.economy.wallet, 1200);
  preset(["10♠", "8♥"], ["10♦", "8♣"], []);
  assert.equal(bj("stand").result.hand.status, "push");
  assert.equal(store.economy.wallet, 1000, "égalité : mise rendue");
  assert.match(playCasino(store, "blackjack", 10, "", CALM_MORNING, undefined, { action: "poker" }).error, /Aucune main|Action/);
  // Blackjack naturel à la distribution : sabot truqué par le tirage (rng) — on essaie jusqu'à en obtenir un.
  let natural = null;
  for (let seed = 0; seed < 400 && !natural; seed++) {
    const s = createStore(); s.economy.wallet = 1000;
    let x = seed; const rng = (a, b) => a + ((x = (x * 1103515245 + 12345) % 2147483648) % (b - a));
    const r = playCasino(s, "blackjack", 100, "", CALM_MORNING, rng, { action: "deal" });
    if (r.result.hand.status === "blackjack") natural = { r, s };
  }
  assert.ok(natural, "un blackjack naturel finit par sortir");
  assert.deepEqual([natural.r.result.win, natural.s.economy.wallet], [250, 1150]);
});

test("tennis et golf : retours moyens sous 100 %, scores de set valides", async () => {
  const { playCasino } = await import("./economy.js");
  const { CASINO } = await import("./public/economy-data.js");
  for (const s of [...CASINO.tennis.styles, ...CASINO.golf.shots]) assert.ok(s.chance * s.payout > 0.9 && s.chance * s.payout < 0.95, s.id);
  const store = createStore();
  store.economy.wallet = 100_000;
  let seed = 7; const rng = (a, b) => a + ((seed = (seed * 1103515245 + 12345) % 2147483648) % (b - a));
  let wins = 0;
  for (let i = 0; i < 150; i++) {
    if (store.economy.day) store.economy.day.casino = { plays: 0, wagered: 0, won: 0 }; // limites du jour remises à zéro pour la statistique
    const { result } = playCasino(store, "tennis", 10, "equilibre", CALM_MORNING, rng);
    const [me, pro] = result.score, top = Math.max(me, pro), low = Math.min(me, pro);
    assert.ok((top === 6 && low <= 4) || (top === 7 && low === 5), result.score.join("-"));
    assert.equal(result.games.length, me + pro);
    assert.equal(result.games.at(-1), result.won ? "toi" : "pro", "le gagnant marque le dernier jeu");
    assert.equal(result.games.filter(g => g === "toi").length, me);
    assert.equal(result.win, result.won ? 19 : 0);
    wins += result.won;
  }
  assert.ok(wins > 40 && wins < 110);
  const putt = playCasino(store, "golf", 100, "long", CALM_MORNING, () => 0);
  assert.deepEqual([putt.result.holed, putt.result.win, putt.result.miss], [true, 420, null]);
  const miss = playCasino(store, "golf", 100, "court", CALM_MORNING, (a, b) => b - 1);
  assert.ok(!miss.result.holed && miss.result.miss);
  assert.match(playCasino(store, "golf", 100, "eagle", CALM_MORNING).error, /putt/);
  assert.match(playCasino(store, "tennis", 100, "", CALM_MORNING).error, /style/);
});

test("jackpot commun : alimenté par les mises, gagné au 7️⃣7️⃣7️⃣, visible de tous", async () => {
  const { playCasino } = await import("./economy.js");
  const store = createStore();
  store.economy.wallet = 1000;
  const lost = playCasino(store, "slots", 100, "", CALM_MORNING, () => 0, { pool: 1500 });
  assert.deepEqual(lost.jackpot, { add: 2 });
  const big = playCasino(store, "slots", 100, "", CALM_MORNING, () => 99, { pool: 1500 });
  assert.deepEqual(big.jackpot, { won: 1500 });
  assert.equal(big.result.progressive, 1500);
  assert.ok(store.economy.ledger.some(e => e.label === "💰 Jackpot commun du penthouse" && e.amount === 1500));
  const { app, url, call, db } = await open();
  try {
    const join = await call("/api/join", { name: "Flambeur", code: "porte" }, { "X-Forwarded-For": "10.3.0.1" });
    const { token } = await join.json(), cookie = join.headers.get("set-cookie").split(";")[0];
    assert.equal((await call("/api/join", { name: "Tennis", code: "porte" }, { "X-Forwarded-For": "10.3.0.2" })).status, 400, "nom réservé");
    db.change("flambeur", s => { s.economy.wallet = 1000; });
    const state = async () => (await fetch(url + "/api/state", { headers: { Cookie: cookie } })).json();
    assert.deepEqual((await state()).casino, { jackpot: 1000, lastWinner: null });
    const spin = await (await call("/api/economy/casino", { game: "slots", bet: 200 }, { Cookie: cookie, "X-Tour-Token": token })).json();
    assert.equal(spin.jackpot, undefined, "le détail interne ne part pas au client");
    const after = (await state()).casino;
    assert.ok(spin.result.progressive ? after.lastWinner.name === "Flambeur" : after.jackpot === 1004);
    const bj = await (await call("/api/economy/casino", { game: "blackjack", action: "deal", bet: 50 }, { Cookie: cookie, "X-Tour-Token": token })).json();
    assert.ok(bj.result.hand.player.length === 2);
    const room = await call("/api/spectate", { room: "Penthouse" }, { "X-Forwarded-For": "10.3.0.3" });
    const spectator = (await (await fetch(url + "/api/state", { headers: { Cookie: room.headers.get("set-cookie").split(";")[0] } })).json());
    assert.ok(Number.isFinite(spectator.casino.jackpot));
    // Activités gratuites des nouveaux étages.
    const rally = await call("/api/game/action", { action: "tennis_rally", floor: "tennis" }, { Cookie: cookie, "X-Tour-Token": token });
    assert.equal(rally.status, 200);
    assert.equal((await call("/api/game/action", { action: "golf_putt", floor: "tennis" }, { Cookie: cookie, "X-Tour-Token": token })).status, 400);
  } finally { app.close(); }
});

test("lecteur de journaux : les appels d'outils comptent comme actions, sans lire leur contenu", async () => {
  const run = promisify(execFile);
  const script = fileURLToPath(new URL("./collecteurs/tour-sync", import.meta.url));
  const python = `import runpy,sys,json
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
count=runpy.run_path(sys.argv[1])['count_actions']
stamp=runpy.run_path(sys.argv[1])['stamp']
claude=[{'timestamp':'2026-11-04T10:00:00Z','type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':{'command':'SECRET'}},{'type':'text','text':'x'}]}},
 {'timestamp':'2026-11-04T10:00:05Z','type':'user','message':{'content':[{'type':'tool_result','content':'SECRET'}]}},
 {'timestamp':'2026-11-04T10:00:09Z','type':'assistant','message':{'content':[{'type':'tool_use','name':'Edit'},{'type':'tool_use','name':'Read'}]}}]
lines=[json.dumps(r) for r in claude]+['pas du json']
n,latest=count('claude',lines,0)
assert n==3 and latest==stamp('2026-11-04T10:00:09Z')
assert count('claude',lines,latest)[0]==0, 'déjà comptées'
assert count('claude',lines,stamp('2026-11-04T10:00:01Z'))[0]==2
codex=[{'timestamp':'2026-11-04T10:00:00Z','type':'response_item','payload':{'type':'function_call','name':'shell'}},
 {'timestamp':'2026-11-04T10:00:01Z','type':'response_item','payload':{'type':'function_call_output','output':'SECRET'}},
 {'timestamp':'2026-11-04T10:00:02Z','type':'response_item','payload':{'type':'custom_tool_call','name':'apply_patch'}}]
assert count('codex',[json.dumps(r) for r in codex],0)[0]==2
`;
  await run("python3", ["-c", python, script]);
  const store = createStore();
  ingest(store, "claude", "mac", { hook_event_name: "PreToolUse", session_id: "s", sync: true, observed_at: 1000, actions: 7 }, 1010);
  ingest(store, "claude", "mac", { hook_event_name: "PreToolUse", session_id: "s", sync: true, observed_at: 1005, actions: 1e9 }, 1010);
  ingest(store, "claude", "mac", { hook_event_name: "PreToolUse", session_id: "t", sync: true, observed_at: 1006, actions: "12" }, 1010);
  assert.equal(snapshot(store, 1010).today.claude.actions, 207, "7, puis 200 au plus par relevé, et rien d'un nombre mal formé");
});
