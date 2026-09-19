/**
 * Switches the showroom the machine is standing in.
 *
 * Both environments are authored into the scene and both stay loaded: together
 * they are 0.7 MB and 9 500 triangles, which is less than one frame's worth of
 * anything else here, and keeping them resident makes the switch instant. Only
 * visibility moves.
 *
 * Each environment owns a light rig, because they do not want the same one. The
 * exhibition gallery ships baked lighting in its textures and only needs enough
 * direct light to ground the machine and cast its shadow; the studio is a dark
 * hall lit by its own emissive strips and needs a harder key to keep the machine
 * from disappearing into it. Hiding a group hides its lights too — three.js
 * gathers lights with `traverseVisible` — so one visibility flag per rig is the
 * whole mechanism.
 */

import { createSystem, signal, type Object3D } from '@iwsdk/core';

interface ShowroomEnvironment {
  /** Scene node id of the environment model. */
  nodeId: string;
  /** Scene node id of the light group that belongs to it. */
  rigId: string;
  label: string;
  /** Shown under the name, so a visitor knows what they are standing in. */
  note: string;
}

/**
 * Order is the order the switch cycles through. The gallery is first because it
 * is 14 m to the ceiling and 50 m across: it is the only one of the two that
 * holds a 7.9 m haul truck without the room becoming the story.
 */
export const SHOWROOM_ENVIRONMENTS: readonly ShowroomEnvironment[] = [
  {
    nodeId: 'showroom-gallery',
    rigId: 'lights-gallery',
    label: 'Galeria de Exhibicion',
    note: '50 x 43 m, 14 m de altura libre',
  },
  {
    nodeId: 'showroom-studio',
    rigId: 'lights-studio',
    label: 'Nave Industrial',
    note: '21 m de ancho, 10 m de altura libre',
  },
];

export class EnvironmentSwitcherSystem extends createSystem({}) {
  readonly activeLabel = signal(SHOWROOM_ENVIRONMENTS[0]?.label ?? '');
  readonly activeNote = signal(SHOWROOM_ENVIRONMENTS[0]?.note ?? '');
  readonly activeIndex = signal(0);

  /** Resolved lazily: the level loads after this system's init(). */
  private resolved = false;
  private readonly nodes: (Object3D | undefined)[] = [];
  private readonly rigs: (Object3D | undefined)[] = [];

  update(): void {
    if (!this.resolved) {
      this.resolve();
    }
    if (this.input.keyboard.getKeyDown('KeyT')) {
      this.next();
    }
  }

  next(): void {
    const count = SHOWROOM_ENVIRONMENTS.length;
    if (count === 0) {
      return;
    }
    this.select((this.activeIndex.peek() + 1) % count);
  }

  select(index: number): void {
    const entry = SHOWROOM_ENVIRONMENTS[index];
    if (entry == null) {
      return;
    }
    this.activeIndex.value = index;
    this.activeLabel.value = entry.label;
    this.activeNote.value = entry.note;
    this.apply();
  }

  private resolve(): void {
    let found = 0;
    for (let i = 0; i < SHOWROOM_ENVIRONMENTS.length; i += 1) {
      const entry = SHOWROOM_ENVIRONMENTS[i];
      this.nodes[i] ??= this.world.getSceneObject(entry.nodeId);
      this.rigs[i] ??= this.world.getSceneObject(entry.rigId);
      if (this.nodes[i] != null) {
        found += 1;
      }
    }
    if (found < SHOWROOM_ENVIRONMENTS.length) {
      return;
    }
    this.resolved = true;
    this.apply();
  }

  /** One flag per environment and per rig. Nothing else distinguishes them. */
  private apply(): void {
    const active = this.activeIndex.peek();
    for (let i = 0; i < SHOWROOM_ENVIRONMENTS.length; i += 1) {
      const visible = i === active;
      const node = this.nodes[i];
      const rig = this.rigs[i];
      if (node != null) {
        node.visible = visible;
      }
      if (rig != null) {
        rig.visible = visible;
      }
    }
  }
}
