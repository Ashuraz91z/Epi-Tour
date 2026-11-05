// Le penthouse en 3D : une tour de verre dans la ville. Sur le toit, la terrasse fumeurs ; puis un étage de travail
// par résident ; puis le Salon (café, repos, tabac, toilettes) et le Club, où les agents de tout le monde se
// retrouvent quand ils ne travaillent pas. Ils voyagent par l'ascenseur. Seul l'étage regardé est ouvert :
// les autres font partie de la tour (moins à dessiner, rien entre la caméra et l'étage).

import { world } from "./tour/state.js";
import { loadModels } from "./tour/models.js";
import { animate } from "./tour/animate.js";
import { refreshLive, tick } from "./ui/session.js";
import "./tour/base.js";
import "./tour/engine.js";
import "./tour/kit.js";
import "./tour/city.js";
import "./tour/robots.js";
import "./tour/work-fx.js";
import "./tour/floors/shell.js";
import "./tour/floors/resident.js";
import "./tour/floors/cyberpunk.js";
import "./tour/floors/prestige.js";
import "./tour/floors/room.js";
import "./tour/floors/shared.js";
import "./tour/floors/casino.js";
import "./tour/floors/tennis.js";
import "./tour/floors/golf.js";
import "./tour/tower.js";
import "./tour/navigation.js";
import "./ui/panel.js";
import "./ui/studio.js";

await Promise.all([document.fonts.ready, loadModels()]);
world.modelsReady = true;
tick();
setInterval(tick, 2000);
refreshLive();
setInterval(refreshLive, 60_000);
animate();
