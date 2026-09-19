/**
 * The exhibit's headline, floating above the machine.
 *
 * A visitor walking up to a 15 m haul truck has no idea what they are looking at
 * until they find the console panel and read it — and by the time they are close
 * enough to be impressed, the console is behind them. The name has to be where
 * the machine is.
 *
 * Above and yaw-facing rather than painted on the back wall, which was the other
 * option. A wall sign is only a sign from one side of a fifty-metre hall, and the
 * whole point of this exhibit is that people walk around the machine.
 *
 * ## Why this is a canvas and not a panel
 *
 * It was a UIKitML panel first. That panel rendered perfectly in
 * `ui_render_preview`, was placed correctly in the scene — right node, right
 * asset child, right transform, `Visibility.isVisible` true, not one warning on
 * any console — and drew nothing at all, at every panel width and node scale
 * tried, with and without `RayInteractable`. Rather than keep hunting it, this
 * draws the text into a `CanvasTexture` on a single quad.
 *
 * That turns out to be the better tool regardless. A headline half a metre tall
 * is one textured plane; routing it through a UI framework buys layout nobody
 * needs and a glyph atlas per letter. It also means this sign can carry proper
 * Spanish accents, which the spatial panels cannot — canvas draws with a real
 * system font, while the panels' bundled font has no glyphs for them.
 */

import {
  CanvasTexture,
  createSystem,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { MachineSwapperSystem } from './machine-swapper.js';

/** Clearance above the top of the machine, in metres. */
const HEADROOM = 2.2;
/** Floor and ceiling for the sign's height. The cap clears the studio's 10.4 m roof. */
const MIN_HEIGHT = 3.4;
const MAX_HEIGHT = 9.6;
/** Physical size of the sign, in metres. */
const SIGN_WIDTH = 6.4;
const SIGN_HEIGHT = 1.6;
/** Texture resolution: 4:1 to match the quad, generous because the letters are huge. */
const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 512;

export class MachineTitleSystem extends createSystem({}) {
  private sign: Mesh | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | null = null;
  private texture: CanvasTexture | undefined;
  /** Held down while the landing page is up: the sign is scene furniture. */
  private suppressed = false;

  /** Preallocated: `update` runs every frame and must not allocate. */
  private readerWorld!: Vector3;
  private signWorld!: Vector3;

  init(): void {
    this.readerWorld = new Vector3();
    this.signWorld = new Vector3(0, MIN_HEIGHT, 0);

    const swapper = this.world.getSystem(MachineSwapperSystem);
    if (swapper == null) {
      return;
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = TEXTURE_WIDTH;
    this.canvas.height = TEXTURE_HEIGHT;
    this.context = this.canvas.getContext('2d');

    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    // Read at every distance from two metres to forty, so the filtering matters
    // more than the sharpness of any single mip.
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.anisotropy = 4;

    this.sign = new Mesh(
      new PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.sign.name = 'machine-title';
    this.sign.visible = false;
    this.world.createTransformEntity(this.sign);

    this.cleanupFuncs.push(
      // The revision rather than the label: the height comes from the measured
      // fit, which only exists once the machine is actually on the floor.
      swapper.mountedRevision.subscribe(() => {
        const entry = swapper.activeEntry;
        if (entry == null) {
          return;
        }
        this.draw(entry.category, entry.label);
        this.signWorld.y = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, (swapper.mountedFit?.height ?? 0) + HEADROOM),
        );
        if (this.sign != null) {
          this.sign.visible = !this.suppressed;
        }
      }),
      // A name with no machine under it is a caption for empty floor.
      swapper.loading.subscribe((loading) => {
        if (this.sign != null && loading) {
          this.sign.visible = false;
        }
      }),
    );
  }

  /**
   * Hide or show the sign from outside.
   *
   * The landing page uses this: the showroom renders behind the marketing copy,
   * and a six-metre name plate hanging across the machine is the one thing in
   * the scene that competes with the page's own headline.
   */
  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    if (this.sign != null && suppressed) {
      this.sign.visible = false;
    }
  }

  update(): void {
    const sign = this.sign;
    if (sign == null || this.suppressed || !sign.visible) {
      return;
    }
    // Over the machine, which is always at the origin — the turntable turns the
    // machine under it, and a headline that swung round with the exhibit would
    // be unreadable for most of the revolution.
    sign.position.copy(this.signWorld);

    this.world.camera.getWorldPosition(this.readerWorld);
    // A plane faces +Z, same as a panel: atan2(dx, dz) toward the reader with no
    // 180-degree term. Yaw only, so the sign stays level however far below it
    // somebody is standing.
    sign.rotation.set(
      0,
      Math.atan2(
        this.readerWorld.x - this.signWorld.x,
        this.readerWorld.z - this.signWorld.z,
      ),
      0,
    );
  }

  /** Repaint the sign. Runs once per machine change, never per frame. */
  private draw(category: string, name: string): void {
    const context = this.context;
    const canvas = this.canvas;
    if (context == null || canvas == null) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);

    // A rounded plate rather than a full-bleed fill, so the sign reads as an
    // object hanging in the hall instead of a rectangle stuck to the viewer.
    const inset = 16;
    context.fillStyle = 'rgba(10, 13, 17, 0.9)';
    context.beginPath();
    context.roundRect(
      inset,
      inset,
      canvas.width - inset * 2,
      canvas.height - inset * 2,
      46,
    );
    context.fill();

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillStyle = '#6fa8ff';
    context.font = '700 62px "Segoe UI", system-ui, sans-serif';
    context.fillText(category, canvas.width / 2, 150);

    context.fillStyle = '#ffffff';
    // Long names have to fit: measure, then shrink until they do, rather than
    // letting "Excavadora Hidraulica de Orugas" run off both ends of the plate.
    const maxWidth = canvas.width - 150;
    let size = 160;
    do {
      size -= 4;
      context.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    } while (size > 56 && context.measureText(name).width > maxWidth);
    context.fillText(name, canvas.width / 2, 330);

    if (this.texture != null) {
      this.texture.needsUpdate = true;
    }
  }
}
