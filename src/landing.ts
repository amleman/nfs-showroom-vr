/**
 * The 2D page in front of the experience.
 *
 * Two audiences arrive at the same URL and they are not the same visitor. One
 * has a Quest on their head and wants to be inside in one press. The other has
 * opened a link on a laptop, has no XR device at all, and — before this page
 * existed — got a static camera angle and a message telling them to come back
 * with a headset. That second visitor is most of the traffic a project like this
 * ever gets, and there is no reason they cannot walk the showroom too: the
 * engine's own browser locomotion plus `DesktopNavigationSystem` is a complete
 * first-person experience.
 *
 * So the page explains the project, and offers both doors. The XR door is
 * disabled with an explanation rather than hidden when there is no device,
 * because a hidden control reads as a broken page.
 *
 * The canvas renders the showroom behind all of this the entire time, which is
 * why the hero is a wash rather than a solid colour and why the page takes
 * pointer events away from the canvas until the visitor actually goes in.
 */

import { LocomotionSystem, SlideSystem, type World } from '@iwsdk/core';
import { AmbienceSystem } from './ambience.js';
import { DesktopNavigationSystem } from './desktop-navigation.js';
import { MACHINE_CATALOG } from './machine-catalog.js';
import { MachineSwapperSystem } from './machine-swapper.js';
import { MachineTitleSystem } from './machine-title.js';
import './landing.css';

/**
 * Footprint of each machine once it is on the floor, in metres.
 *
 * The height of every machine is in `MACHINE_CATALOG`, but its length and width
 * are consequences of that height and the model's own proportions, and they only
 * exist after `fitMachineToFloor` has measured them at load time — which is far
 * too late for a card the visitor reads before entering. So the two derived
 * numbers are recorded here.
 *
 * They are display copy, not the source of truth: the spec panel inside the
 * scene always quotes what it measured. Refresh these with `npm run inspect`
 * after changing any machine's `realHeight`.
 */
const FOOTPRINT: Record<string, { length: number; width: number }> = {
  'machine-dump-truck': { length: 15.5, width: 9.0 },
  'machine-excavator': { length: 11.2, width: 4.1 },
  'machine-backhoe': { length: 8.3, width: 2.3 },
  'machine-robot-arm': { length: 2.1, width: 1.4 },
  'machine-precision-arm': { length: 3.7, width: 2.4 },
  'machine-service-truck': { length: 7.5, width: 3.2 },
  'machine-tracked-vehicle': { length: 8.9, width: 4.0 },
};

/**
 * The scene's own panels, hidden while the landing page is up.
 *
 * The showroom renders behind the marketing copy the whole time, which is the
 * point — but the spatial console is three large light-coloured panels hanging
 * in mid-air, and from the hero camera they land across the machine and under
 * the page's own text. The machine should be the only thing back there.
 */
const SCENE_PANELS = [
  'machine-selector-panel',
  'machine-specs-panel',
  'inspection-panel',
];

/**
 * The closing lines, rotated in the footer.
 *
 * All of them are about the medium rather than about the machines, because that
 * is the part a visitor cannot get from the rest of the page: a deck is
 * information, and this is somewhere you have been.
 *
 * Each is a setup and a turn, not a slogan. The first half earns the second, and
 * the split is where the gradient starts — so the turn in the sentence and the
 * turn in the colour land together.
 */
const CLOSING_LINES: readonly [string, string][] = [
  [
    'Puedes describir una máquina durante una hora y no haber dicho nada de su tamaño.',
    'Quien puede llevarte no necesita convencerte.',
  ],
  [
    'De lo que te explican queda un resumen; de lo que te ocurre queda el lugar.',
    'La memoria no guarda argumentos: guarda lugares.',
  ],
  [
    'Hay distancias que ningún informe recorre. Entre saber la cifra y haber estado al lado hay un paso,',
    'y ese paso no lo da ninguna página.',
  ],
  [
    'Nadie respeta de verdad lo que solo ha leído. El riesgo que se entiende de lejos nunca llegó a entenderse:',
    'se aprende teniéndolo enfrente, o se aprende tarde.',
  ],
  [
    'El que mira vuelve informado; el que entra vuelve distinto.',
    'Ninguna cifra ha cambiado nunca a nadie.',
  ],
  [
    'No preguntes cuánto mide. Ponte al lado y deja que te mida a ti.',
    'Lo demás es literatura.',
  ],
];

/**
 * How long each one holds, in milliseconds.
 *
 * Long enough to read two sentences without hurrying. An earlier version cycled
 * single clauses every six seconds and they went past before they meant
 * anything — a sentence with no setup is not an aphorism, it is a fragment.
 */
const QUOTE_INTERVAL = 9500;
/** Must match the `quote-out` animation in landing.css. */
const QUOTE_FADE = 300;

/** Scroll distance, as a fraction of the viewport, before the dock appears. */
const DOCK_THRESHOLD = 0.55;
/** Peak hero drift from the pointer, in pixels. */
const POINTER_DRIFT = 18;

export function startLanding(world: World): void {
  const landing = document.getElementById('landing');
  const container = document.getElementById('scene-container');
  const dock = document.getElementById('dock');
  if (landing == null || container == null) {
    return;
  }

  // The page scrolls over the canvas, so until the visitor goes in the canvas
  // must not swallow the gestures that scroll it.
  container.style.pointerEvents = 'none';
  landing.dataset.state = 'landing';
  // And the arrow keys that scroll this page are also bound to strafing now, so
  // reading the landing would otherwise walk the visitor away from the spawn
  // before they ever saw it.
  setLocomotion(world, false);
  setSceneUi(world, false);

  const backChip = createBackChip();
  let entered = false;

  const enter = (mode: 'xr' | 'browser', machineIndex?: number): void => {
    // Selecting before entering means the machine is already downloading while
    // the page is still fading out, rather than after.
    if (machineIndex != null) {
      world.getSystem(MachineSwapperSystem)?.select(machineIndex);
    }
    if (mode === 'xr') {
      world.launchXR();
    }
    if (entered) {
      return;
    }
    entered = true;
    landing.dataset.state = 'entered';
    container.style.pointerEvents = 'auto';
    document.body.style.overflow = 'hidden';
    setLocomotion(world, true);
    setSceneUi(world, true);
    if (dock != null) {
      dock.hidden = true;
    }
    backChip.hidden = false;
    // Even when the visitor went in through XR: taking the headset off ends the
    // session and drops them back to this same page, and the desktop camera is
    // what they land in.
    world.getSystem(DesktopNavigationSystem)?.enable();
    // This call is inside the button's own handler on purpose: it is the user
    // gesture the browser requires before an AudioContext will actually run.
    world.getSystem(AmbienceSystem)?.start();
    window.scrollTo(0, 0);
  };

  const leave = (): void => {
    entered = false;
    landing.dataset.state = 'landing';
    container.style.pointerEvents = 'none';
    document.body.style.overflow = '';
    setLocomotion(world, false);
    setSceneUi(world, false);
    backChip.hidden = true;
    window.scrollTo(0, 0);
  };

  backChip.addEventListener('click', leave);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && entered) {
      leave();
    }
  });

  bindEntryButtons(world, enter);
  buildCatalog(enter);
  bindClosingLines();
  bindParallax();
  bindReveal();
  bindDock(dock);
}

/**
 * Build the catalogue grid from the same list the scene loads from.
 *
 * Generated rather than written into the markup so the page can never advertise
 * a machine the carousel does not have, or miss one it does — and so each card's
 * button can name the index it selects.
 */
function buildCatalog(
  enter: (mode: 'xr' | 'browser', machineIndex?: number) => void,
): void {
  const grid = document.getElementById('catalog');
  if (grid == null) {
    return;
  }

  MACHINE_CATALOG.forEach((entry, index) => {
    const footprint = FOOTPRINT[entry.assetId];
    const dimensions: [string, string][] = [
      ['LARGO', footprint == null ? '—' : `${footprint.length.toFixed(1)} m`],
      ['ANCHO', footprint == null ? '—' : `${footprint.width.toFixed(1)} m`],
      ['ALTO', `${entry.realHeight.toFixed(1)} m`],
    ];

    const unit = document.createElement('article');
    unit.className = 'unit glass';
    unit.dataset.reveal = '';

    const badge = document.createElement('span');
    badge.className = 'unit-badge';
    badge.textContent = entry.category;

    const name = document.createElement('h3');
    name.className = 'unit-name';
    name.textContent = entry.label;

    const reference = document.createElement('p');
    reference.className = 'unit-ref';
    reference.textContent = entry.reference;

    const dims = document.createElement('div');
    dims.className = 'unit-dims';
    for (const [key, value] of dimensions) {
      const chip = document.createElement('span');
      chip.className = 'dim';
      const keyEl = document.createElement('span');
      keyEl.className = 'dim-key';
      keyEl.textContent = key;
      const valueEl = document.createElement('span');
      valueEl.className = 'dim-value';
      valueEl.textContent = value;
      chip.append(keyEl, valueEl);
      dims.append(chip);
    }

    const foot = document.createElement('div');
    foot.className = 'unit-foot';
    const headline = entry.specs[0];
    const spec = document.createElement('span');
    spec.className = 'unit-spec';
    spec.textContent =
      headline == null ? '' : `${headline.label}: ${headline.value}`;

    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'unit-cta';
    cta.textContent = 'Ver en 3D';
    cta.addEventListener('click', () => enter('browser', index));

    foot.append(spec, cta);
    unit.append(badge, name, reference, dims, foot);
    grid.append(unit);
  });
}

/**
 * Rotate the footer's closing line.
 *
 * Pauses on hover, so somebody who is part way through reading one does not
 * lose it, and starts from the strongest line rather than a random one — the
 * first is the one most visitors will be the only one to see.
 */
function bindClosingLines(): void {
  const element = document.getElementById('foot-quote');
  if (element == null || CLOSING_LINES.length < 2) {
    return;
  }

  let index = 0;
  let timer = 0;
  let paused = false;

  const render = (): void => {
    const [lead, accent] = CLOSING_LINES[index];
    element.textContent = `${lead} `;
    const span = document.createElement('span');
    span.className = 'grad';
    span.textContent = accent;
    element.append(span);
  };

  const advance = (): void => {
    if (paused) {
      return;
    }
    element.classList.remove('is-in');
    element.classList.add('is-out');
    window.setTimeout(() => {
      index = (index + 1) % CLOSING_LINES.length;
      render();
      element.classList.remove('is-out');
      // Restart the animation: without the reflow the class goes back on in the
      // same frame it came off and nothing plays.
      void element.offsetWidth;
      element.classList.add('is-in');
    }, QUOTE_FADE);
  };

  element.addEventListener('pointerenter', () => {
    paused = true;
  });
  element.addEventListener('pointerleave', () => {
    paused = false;
  });

  timer = window.setInterval(advance, QUOTE_INTERVAL);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
}

/**
 * Show or hide the scene's spatial UI.
 *
 * Retried on a few frames rather than applied once: the level loads
 * asynchronously, so at the moment the landing page starts, none of these scene
 * objects exist yet.
 */
function setSceneUi(world: World, visible: boolean): void {
  let attempts = 0;
  const apply = (): void => {
    let found = 0;
    for (const id of SCENE_PANELS) {
      const panel = world.getSceneObject(id);
      if (panel != null) {
        panel.visible = visible;
        found += 1;
      }
    }
    world.getSystem(MachineTitleSystem)?.setSuppressed(!visible);
    attempts += 1;
    if (found < SCENE_PANELS.length && attempts < 240) {
      requestAnimationFrame(apply);
    }
  };
  apply();
}

/**
 * Suspend or resume walking.
 *
 * `SlideSystem` is the one that actually moves the rig and it registers
 * asynchronously, after the locomotor initialises, so `getSystem` can hand back
 * nothing on an early call — hence the optional chaining rather than a lookup
 * cached at startup.
 */
function setLocomotion(world: World, running: boolean): void {
  for (const system of [
    world.getSystem(LocomotionSystem),
    world.getSystem(SlideSystem),
  ]) {
    if (running) {
      system?.play();
    } else {
      system?.stop();
    }
  }
}

/**
 * Wire both doors, and decide which one is real on this device.
 *
 * `isSessionSupported` is the honest question — `world.xrEnabled` only reports
 * whether the project asked for XR, not whether this browser can give it.
 */
function bindEntryButtons(
  world: World,
  enter: (mode: 'xr' | 'browser') => void,
): void {
  const xrButtons = ['cta-xr', 'dock-xr']
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLButtonElement => element != null);
  const browserButtons = ['cta-browser', 'dock-browser']
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLButtonElement => element != null);
  const note = document.getElementById('xr-note');

  for (const button of xrButtons) {
    button.addEventListener('click', () => enter('xr'));
    button.disabled = true;
  }
  for (const button of browserButtons) {
    button.addEventListener('click', () => enter('browser'));
  }

  void (async () => {
    let supported = false;
    try {
      supported =
        world.xrEnabled &&
        ((await navigator.xr?.isSessionSupported('immersive-vr')) ?? false);
    } catch {
      supported = false;
    }

    for (const button of xrButtons) {
      button.disabled = !supported;
    }
    if (supported) {
      if (note != null) {
        note.textContent =
          'Visor detectado. Recomendado: la escala real es el punto de la experiencia.';
      }
      return;
    }
    // No device. Promote the browser door rather than leaving the visitor
    // looking at a dead button.
    for (const button of browserButtons) {
      button.classList.remove('btn--ghost');
      button.classList.add('btn--primary');
    }
    if (note != null) {
      note.textContent =
        'Este navegador no expone un dispositivo XR. Ábrelo en el navegador de Meta Quest para el modo inmersivo, o recorre la experiencia aquí mismo en primera persona.';
    }
  })();
}

/**
 * Parallax, from scroll and from the pointer, in one transform per element.
 *
 * Both inputs write the same property, so they are composed here rather than
 * fighting over `style.transform`, and the whole thing is folded into a single
 * rAF so a fast scroll cannot queue a frame's worth of layout reads.
 */
function bindParallax(): void {
  const layers = [...document.querySelectorAll<HTMLElement>('[data-parallax]')];
  if (layers.length === 0) {
    return;
  }
  const rates = layers.map(
    (layer) => Number(layer.dataset.parallax ?? '0.2') || 0.2,
  );

  let scrollY = window.scrollY;
  let pointerX = 0;
  let pointerY = 0;
  let queued = false;

  const apply = (): void => {
    queued = false;
    for (let i = 0; i < layers.length; i += 1) {
      const rate = rates[i];
      const x = pointerX * POINTER_DRIFT * rate;
      const y = pointerY * POINTER_DRIFT * rate - scrollY * rate;
      layers[i].style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    }
  };
  const schedule = (): void => {
    if (queued) {
      return;
    }
    queued = true;
    requestAnimationFrame(apply);
  };

  window.addEventListener(
    'scroll',
    () => {
      scrollY = window.scrollY;
      schedule();
    },
    { passive: true },
  );
  window.addEventListener(
    'pointermove',
    (event) => {
      pointerX = (event.clientX / window.innerWidth) * 2 - 1;
      pointerY = (event.clientY / window.innerHeight) * 2 - 1;
      schedule();
    },
    { passive: true },
  );
  apply();
}

/** Fade sections in as they arrive. Everything is visible without JS. */
function bindReveal(): void {
  const targets = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (targets.length === 0) {
    return;
  }
  if (typeof IntersectionObserver === 'undefined') {
    for (const target of targets) {
      target.classList.add('is-in');
    }
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
  );
  for (const target of targets) {
    observer.observe(target);
  }
}

/** The fixed dock appears once the hero has scrolled away. */
function bindDock(dock: HTMLElement | null): void {
  if (dock == null) {
    return;
  }
  const update = (): void => {
    const past = window.scrollY > window.innerHeight * DOCK_THRESHOLD;
    dock.hidden = !past;
    dock.dataset.visible = past ? 'true' : 'false';
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/**
 * A way back out of the scene.
 *
 * Built here rather than in the markup because it only exists once the visitor
 * has gone in, and a control that is in the DOM from the first paint is a
 * control somebody clicks before it means anything.
 */
function createBackChip(): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = 'Volver al inicio';
  chip.hidden = true;
  chip.style.cssText = [
    'position:fixed',
    'z-index:4',
    'top:16px',
    'left:16px',
    'padding:9px 16px',
    'border-radius:999px',
    'border:1px solid rgba(255,255,255,0.22)',
    'background:rgba(10,13,17,0.72)',
    'backdrop-filter:blur(12px)',
    'color:#fff',
    'font:700 13px/1 "DM Sans",system-ui,sans-serif',
    'cursor:pointer',
  ].join(';');
  document.body.appendChild(chip);
  return chip;
}
