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
import { DesktopNavigationSystem } from './desktop-navigation.js';
import './landing.css';

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

  const backChip = createBackChip();
  let entered = false;

  const enter = (mode: 'xr' | 'browser'): void => {
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
    if (dock != null) {
      dock.hidden = true;
    }
    backChip.hidden = false;
    // Even when the visitor went in through XR: taking the headset off ends the
    // session and drops them back to this same page, and the desktop camera is
    // what they land in.
    world.getSystem(DesktopNavigationSystem)?.enable();
    window.scrollTo(0, 0);
  };

  const leave = (): void => {
    entered = false;
    landing.dataset.state = 'landing';
    container.style.pointerEvents = 'none';
    document.body.style.overflow = '';
    setLocomotion(world, false);
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
  bindParallax();
  bindReveal();
  bindDock(dock);
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
