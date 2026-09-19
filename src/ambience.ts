/**
 * The sound of the room.
 *
 * The brief asked whether to add music or machine ambience, and the answer is
 * ambience. Music tells a visitor they are in a game; room tone tells them they
 * are in a building. A hall this size is never silent — there is air handling, a
 * compressor somewhere, the low hum of a plant — and a VR scene with no sound at
 * all reads as a render rather than a place. A soundtrack would also have to be
 * licensed, would fight the person standing next to the visitor explaining the
 * exhibit, and would get old by the fifth demo of the day.
 *
 * ## Why this is synthesised and not a recording
 *
 * Nothing is downloaded, nothing is licensed, nothing has to be on the laptop
 * for the stand to work, and the bed loops forever without a seam. Three layers,
 * all quiet:
 *
 * - a wide, heavily filtered noise bed — the air in a large hall,
 * - two detuned low oscillators — plant hum, the thing you feel more than hear,
 * - a machine layer that fades up only while a machine's own cycle is running.
 *
 * To use real recordings instead, drop them in `public/audio/` and replace the
 * three `create*` methods with buffer sources; everything else here — the
 * gesture gate, the visibility handling, the mute — stays as it is.
 *
 * ## The gesture gate
 *
 * Browsers refuse to start an `AudioContext` outside a user gesture, so nothing
 * is created until `start()` is called, and `start()` is called from the landing
 * page's own button handler.
 */

import { createSystem, signal, VisibilityState } from '@iwsdk/core';
import { MachineSwapperSystem } from './machine-swapper.js';

/** Overall level. Deliberately low: this is a floor, not a feature. */
const MASTER_GAIN = 0.5;
/** Seconds of noise in the loop. Long enough that the ear cannot find the seam. */
const NOISE_SECONDS = 4;
/** Seconds to fade the machine layer in and out with the animation. */
const MACHINE_FADE = 1.4;

export class AmbienceSystem extends createSystem({}) {
  /** Whether the bed is running. The UI can subscribe to offer a mute. */
  readonly playing = signal(false);
  readonly muted = signal(false);

  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private machineGain: GainNode | undefined;
  private started = false;

  init(): void {
    const swapper = this.world.getSystem(MachineSwapperSystem);
    this.cleanupFuncs.push(
      // A machine running its cycle should be audible. Nothing else on this
      // floor moves, so this is the only layer that ever changes.
      swapper?.cycleRunning.subscribe((running) => {
        this.setMachineLevel(running ? 1 : 0);
      }) ?? (() => {}),
      // Taking the headset off, or tabbing away, should not leave a hum running
      // in a browser the visitor has stopped looking at.
      this.world.visibilityState.subscribe((state) => {
        if (this.context == null) {
          return;
        }
        if (state === VisibilityState.VisibleBlurred) {
          void this.context.suspend();
        } else {
          void this.context.resume();
        }
      }),
    );
  }

  update(): void {
    if (this.input.keyboard.getKeyDown('KeyM')) {
      this.toggleMute();
    }
  }

  /**
   * Build and start the bed. Safe to call more than once.
   *
   * Must be called from inside a user gesture — a click or a controller press —
   * or the browser will create the context in a suspended state and never run
   * it.
   */
  start(): void {
    if (this.started) {
      void this.context?.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctor == null) {
      return;
    }
    this.started = true;

    const context = new Ctor();
    this.context = context;
    const master = context.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(context.destination);
    this.master = master;

    this.createHallTone(context, master);
    this.createPlantHum(context, master);
    this.machineGain = this.createMachineLayer(context, master);

    void context.resume();
    this.playing.value = true;
  }

  toggleMute(): void {
    const next = !this.muted.peek();
    this.muted.value = next;
    if (this.master != null && this.context != null) {
      this.master.gain.setTargetAtTime(
        next ? 0 : MASTER_GAIN,
        this.context.currentTime,
        0.08,
      );
    }
  }

  /** Wide filtered noise: the air in a large hall. */
  private createHallTone(context: AudioContext, output: GainNode): void {
    const source = context.createBufferSource();
    source.buffer = this.createNoiseBuffer(context);
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    filter.Q.value = 0.4;

    const gain = context.createGain();
    gain.gain.value = 0.16;

    source.connect(filter).connect(gain).connect(output);
    source.start();
  }

  /**
   * Two low oscillators a hair apart, which beat against each other slowly.
   * That slow beating is what stops a steady tone sounding synthetic.
   */
  private createPlantHum(context: AudioContext, output: GainNode): void {
    const gain = context.createGain();
    gain.gain.value = 0.045;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;

    for (const frequency of [49.2, 98.9]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.connect(filter);
      oscillator.start();
    }
    filter.connect(gain).connect(output);
  }

  /**
   * Hydraulics and drivetrain, silent until a machine is actually moving.
   * Returns the gain node so the cycle signal can fade it.
   */
  private createMachineLayer(
    context: AudioContext,
    output: GainNode,
  ): GainNode {
    const gain = context.createGain();
    gain.gain.value = 0;

    const source = context.createBufferSource();
    source.buffer = this.createNoiseBuffer(context);
    source.loop = true;

    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 520;
    band.Q.value = 1.6;

    const motor = context.createOscillator();
    motor.type = 'triangle';
    motor.frequency.value = 132;
    const motorGain = context.createGain();
    motorGain.gain.value = 0.35;

    source.connect(band).connect(gain);
    motor.connect(motorGain).connect(gain);
    gain.connect(output);
    source.start();
    motor.start();
    return gain;
  }

  private setMachineLevel(level: number): void {
    if (this.machineGain == null || this.context == null) {
      return;
    }
    this.machineGain.gain.setTargetAtTime(
      level * 0.09,
      this.context.currentTime,
      MACHINE_FADE / 3,
    );
  }

  /**
   * White noise run through a one-pole lowpass, which tilts it toward pink.
   * Flat white noise is hiss; tilted noise is a room.
   */
  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = context.sampleRate * NOISE_SECONDS;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.96 + white * 0.04;
      data[i] = previous * 3.2;
    }
    return buffer;
  }
}
