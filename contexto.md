# Contexto del proyecto

Lee este archivo antes de tocar nada. Está escrito para que puedas entender el
proyecto entero sin abrir los demás archivos, y para que sepas dónde mirar
cuando necesites profundizar.

---

## 1. Qué es

**NFS Showroom VR** — un showroom de autos en WebXR para Meta Quest 3, sobre el
Immersive Web SDK de Meta. El jugador está en un garaje industrial inspirado en
el refugio de *Need for Speed: Most Wanted* (2005), con un auto iluminado sobre
una tarima giratoria. Puede cambiar de auto desde paneles espaciales, abrir las
puertas y meterse al asiento del conductor.

**Estado: terminado como experimento.** Se construyó para encontrar los límites
de IWSDK y para probar hasta dónde llega el desarrollo dirigido por agentes.
Ambas preguntas quedaron respondidas y ahí se detuvo. Funciona; varias
funcionalidades planeadas quedaron deliberadamente sin construir (§8).

Repo: https://github.com/amleman/nfs-showroom-vr · rama única: `main`.

---

## 2. Stack

| | |
| --- | --- |
| Framework | IWSDK (`@iwsdk/core` **0.5.3**) |
| Render | three.js **r181** vía `super-three` (alias del paquete `three`) |
| ECS | elics 3.4.x |
| UI | UIKitML, kit Horizon |
| Lenguaje | TypeScript |
| Build | Vite 7 |
| Objetivo | Navegador de Quest 3 (WebXR); también corre en navegador de escritorio |

---

## 3. Lo que NO funciona como un Vite normal

Esto es lo que más tiempo hace perder si lo asumes al revés. `CLAUDE.md` lo
detalla; aquí va lo imprescindible:

- **`iwsdk.config.json` es la autoridad**, no `vite.config.ts`. Ahí se eligen la
  escena activa, el módulo de assets, el de componentes y las features de XR.
- **`virtual:iwsdk-project`** es un módulo virtual, no un archivo.
- **El dev server es gestionado por CLI**: `npx iwsdk dev up`, nunca `vite`.
  Abre un navegador gestionado que hospeda el puente MCP. Una sola ventana
  alberga dos roles, **editor** y **runtime**.
- **`src/assets.ts` se evalúa dos veces**, en dos realms distintos (runtime y
  editor). Debe ser determinista y sin efectos secundarios.
- **Importa three desde `@iwsdk/core`, nunca desde `three`.** Importar `three`
  directo crea una segunda instancia y rompe cosas de forma sutil.
- **Geometría estática en TypeScript, composición en JSON.** El JSON de escena
  solo referencia IDs del manifiesto, jamás URLs ni materiales.
- **`entity.dispose()`**, nunca `entity.destroy()` (fuga de VRAM).

---

## 4. Arquitectura

### Flujo de arranque

`src/index.ts` → `World.create(projectOptions)` → registra sistemas en orden
explícito. **El orden importa**: cada uno resuelve al anterior en su `init()`.

```
CarSwapperSystem          carrusel, carga bajo demanda, LRU, puertas
CarTurntableSystem        giro de la tarima
CarSelectorPanelSystem    panel espacial → swapper/turntable
CarSeatSystem             asiento del conductor (suspende input de los dos de arriba)
MusicPlayerSystem         playlist aleatoria, PositionalAudio, AudioAnalyser
MusicPanelSystem          panel del reproductor
AudioReactiveLedSystem    barras LED ← analyser del reproductor
PanelSystem               panel de bienvenida (entrar/salir de XR)
RenderTuningSystem        foveation + sombras bajo demanda
TurnPivotCapture (-10) / TurnPivotCorrect (+10)   envuelven al TurnSystem interno
```

`RobotSystem` es resto del scaffold original: su query está vacía y no cuesta
nada, pero es código muerto.

### Grafo de escena (`public/scenes/main.iwsdk.scene.json`)

```
garage                    {LocomotionEnvironment}
showroom-stage
└── turntable             ← CarTurntableSystem rota este nodo
    ├── display-platform  {LocomotionEnvironment}
    └── car-mount         ← el auto activo se cuelga aquí
key-spot / rim-back / rim-left / bay-back-glow / ambient-warm   (5 luces)
car-selector-panel · music-player-panel · welcome-panel   {RayInteractable}
sound-system · sound-system-copy      ← PositionalAudio de la música
led-strip-left · led-strip-right      ← ecualizador
raíz: DomeGradient + IBLTexture · environment: { shadows: true, pcf }
```

**Los sistemas resuelven nodos por su ID de escena**, nunca por índice de
entidad ni por URL. La jerarquía de un auto montado es:

```
car-mount → pivot (lleva el yawDeg de presentación) → modelo glTF (ya ajustado)
```

El **espacio del pivote** es el sistema de coordenadas en el que se declaran
todos los anclajes por auto (asiento, y en el futuro encendido/motor): gira con
el auto y sobrevive a un cambio de ángulo de presentación.

### Datos por auto — `src/car-catalog.ts`

Ocho autos. Cada entrada declara `assetId`, `label`, `yawDeg` y opcionalmente
`seat`. **Sin heurísticas, por decisión explícita**: deducir cuál material es la
carrocería tomando el de más triángulos **falla en 5 de 7 autos**, porque rines
y tornillos tienen más triángulos que la chapa. Lo mismo vale para asientos y
faros. Cada funcionalidad **se desactiva sola** en el auto que no declara su
dato (patrón ya usado en `hasDoors`).

**Solo el Razor M3 tiene asiento calibrado.** Los otros siete no declaran `seat`
y por tanto no se pueden entrar. El sistema funciona; faltan los datos.

---

## 5. Qué hay implementado

| Archivo | Qué hace |
| --- | --- |
| `src/car-swapper.ts` | Carga bajo demanda + **LRU de 2 residentes**. Un `Map` itera en orden de inserción, que es exactamente una cola LRU. Al expulsar: `disposeHierarchy()` **y** `CacheManager.deleteAsset()`. Warm-up de shaders con `compileAsync` antes de mostrar. Puertas por `AnimationMixer`. |
| `src/car-fit.ts` | Normaliza descargas arbitrarias: oculta planos de suelo y calcomanías, endereza modelos Z-up, escala a 4.6 m, centra y asienta sobre la tarima. |
| `src/car-seat.ts` | Asiento del conductor. Cinco restricciones del rig documentadas en su cabecera (§7). |
| `src/car-turntable.ts` | Una revolución con smoothstep sobre el nodo `turntable`. |
| `src/car-finish.ts` | Acabado PBR de la pintura. **Solo uniformes**, nunca activa features que no existían (cambiaría la permutación de shader). |
| `src/music-player.ts` | Playlist barajada, `PositionalAudio` en ambas bocinas desde **un solo buffer** decodificado, tap de `AudioAnalyser`. Reutiliza el `AudioListener` que `AudioSystem` ya puso en la cabeza. |
| `src/audio-reactive-led.ts` | Escribe directo en `instanceMatrix`/`instanceColor`. Cero asignaciones por frame. |
| `src/render-tuning.ts` | Foveation 0.75; `shadowMap.autoUpdate = false` + invalidación por señales. |
| `src/gpu-memory.ts` | `disposeHierarchy()`: geometrías → materiales → texturas, con `Set` para deduplicar. **Excluye `envMap` a propósito.** |
| `src/turn-pivot.ts` | Envuelve al `TurnSystem` interno para que el giro pivote sobre la cabeza, no sobre el origen del espacio de juego. |
| `src/scene-assets/*.ts` | Prototipos `Object3D` procedurales: tarima y tira LED. |

### Scripts

| | |
| --- | --- |
| `npm run dev` | Dev server gestionado (corre `models` y `music` antes) |
| `npm run models` | Reconstruye los modelos a tamaño de visor (incremental; `models:force` rehace todo) |
| `npm run inspect` | Vuelca materiales, nodos y bounds de un modelo en coordenadas de escena |
| `npm run music` | Regenera `playlist.json` desde `public/audio/music/` |
| `npm run typecheck` | `tsc --noEmit` |

`scripts/glb.mjs` es el lector/escritor GLB compartido por los otros dos.

---

## 6. El problema de rendimiento (lo más importante que se aprendió)

El catálogo pedía **4,477 MB de VRAM de texturas** contra ~1 GB de margen en una
Quest. Un solo modelo, `bmw_m3_gtr_e46_black.glb`, con **cuarenta texturas de
4096×4096**, se comía **3.4 GB**. La app se congelaba al cuarto auto.

`scripts/optimize-models.mjs` limita color a 1024 y mapas de datos a 512,
deduplica por contenido y reencoda a WebP:

| | Antes | Después |
| --- | --- | --- |
| VRAM del catálogo | 4,477 MB | **525 MB** |
| Peor par residente | — | ~186 MB |
| En disco | 165 MB | 57 MB |

La salida va a **`public/gltf/optimized/`, gitignoreada y generada** — como
`playlist.json`. Las fuentes de al lado son lo versionado. `src/assets.ts`
apunta a las optimizadas; apuntarlo a las crudas mata la app en el cuarto auto.

**Queda disponible otro ~8×** con KTX2/BasisU, que se queda comprimido en VRAM y
que el loader de IWSDK ya soporta. Necesita un binario encoder nativo
(`toktx`, o un build nativo de gltfpack — el de npm viene **sin** BasisU).

Estado actual medido: **87–112 draw calls**, memoria plana a lo largo de una
vuelta completa al carrusel (`geometries` estable en ~162).

---

## 7. Trampas encontradas — no las redescubras

### Rig y locomoción

- **`player.rotation.y = θ` es silenciosamente un no-op** cuando algo tocó el
  quaternion desde la última lectura: el resync interno corre primero y descarta
  lo que escribiste. Escribe siempre el **quaternion**.
- **La posición del rig va por `LocomotionSystem.setPlayerPosition()`**.
  Escribir `player.position` es inútil: el locomotor lo re-estampa cada frame.
- **Para anclar al jugador hay que pausar `LocomotionSystem` entero**, no solo
  los sistemas de input. Si sigue corriendo, la gravedad (9.81) lo arrastra
  fuera del asiento en ~1 s.
- **`TurnPivotCapture`/`TurnPivotCorrect` también hay que pausarlos**: el
  segundo escribe `player.position` con prioridad 10.
- **`SlideSystem` y `TeleportSystem` se registran de forma asíncrona**, después
  de que el locomotor inicializa. `getSystem()` puede devolver `undefined`.
- **El ancla del asiento es el ojo, pero `setPlayerPosition` coloca el origen
  del rig**: hay que restar el offset de la cabeza en **los tres ejes**. Dejar Y
  fuera te deja 1.6 m sobre el techo mirando hacia abajo.

### Assets y memoria

- **`AssetManager.loadGLTFById()` devuelve el objeto cacheado, no un clon.**
  Mutar un material muta la caché para toda la sesión.
- **`getGLTF()` clona solo el árbol de nodos**; geometrías, materiales y
  animaciones siguen compartidos. No protege un material de ser mutado.
- **Excluye `envMap` del barrido de texturas al liberar**: apunta al IBL
  compartido y disponerlo apaga todos los demás materiales.

### Render

- **Las sombras están apagadas salvo que el documento de escena las declare.**
  `castShadow`, `shadowBias` y `shadowMapSize` en una luz no hacen **nada** sin
  `environment.shadows: true`. No avisa.
- **`GLTFLoader` deja todo en `castShadow: false`**, y un modelo cargado por
  `AssetManager` no pasa por la ruta que aplica `content.castShadow`. Hay que
  recorrerlo a mano.
- **El `yawDeg` aplicado antes del fit falsea la escala**: el fit escala para que
  el *bounding box medido* dé 4.6 m, y un box alrededor de un auto ya rotado es
  más grande que el auto. Por eso el yaw vive en un pivote **encima** del fit.
- Varios modelos traen **la firma del autor como un quad de 2 triángulos y
  altura cero** en el suelo, que descentra el modelo. Hay un test dedicado.
- **Bloom con `EffectComposer` normalmente no es viable en sesión XR**: pelea
  con el framebuffer estéreo. Alternativa: geometría emisiva *unlit* con valores
  >1 bajo ACES, más cartas aditivas.

### UIKitML

- **Un botón en una segunda fila bajo la fila principal se renderiza, y
  `getElementById` lo resuelve, pero nunca recibe clics de ray.** Todos los
  controles en UNA fila, o en un panel aparte.
- **El parser de `<style>` rechaza comentarios `/* */`** y eso tumba la carga
  del **nivel entero**, no solo del panel.
- Los iconos Lucide ignoran el dimensionado por clase y por atributo.
- Las medidas numéricas son centímetros. Los paneles son de una cara, hacia +Z.

### Animación

- **Una `AnimationAction` pausada no aporta nada al mixer.** Mover `action.time`
  a mano con la acción pausada no hace nada; la dirección se maneja con
  `timeScale`.

### Emulador XR

- Las poses de los dispositivos son **relativas al jugador, no al mundo**.
- `xr_select` (pulsación con duración real) sí dispara clics de UIKit; escribir
  el valor de select de golpe, no.
- **El probe de `render-stats` falla con la sesión XR activa** (artefacto de los
  gizmos del emulador, no del código). Mide fuera de XR.

---

## 8. Lo que NO está construido

Planeado, diseñado y deliberadamente sin hacer:

- **Audio de motor.** Las fuentes son mods de NFS en `.abk`/`.gin`. `vgmstream`
  decodifica ambos (`ea_schl_abk.c` y `gin.c`), pero el `.gin` es audio
  **granular** — granos más curvas para resintetizar según RPM — así que da
  material crudo, no un ralentí listo. Además es material con copyright de EA.
- **Faros y calaveras.** Necesitan nombres de material por auto, que hay que
  recoger modelo por modelo con `npm run inspect`.
- **Pintura inmersiva con pistola.** Hay un plan aprobado y sin implementar en
  `docs/plan-cambio-de-color-de-pintura.md`, que ya trae **el nombre exacto del
  material de carrocería de 6 de los 8 autos**. Nota de diseño: la pistola debe
  agarrarse con **squeeze** (`OneHandGrabbable`), porque un objeto agarrado de
  cerca **no recibe las etiquetas `Hovered`/`Pressed`** y el gatillo tiene que
  quedar libre para rociar; se lee vía `getHolderHand()` + el gamepad.
- **Props agarrables, intro cinemático y easter egg.**
- Los **otros siete asientos** sin calibrar.

---

## 9. Cómo se trabaja aquí

### Flujo de verificación (en este orden)

```sh
npx tsc --noEmit        # errores de tipo impiden que los sistemas inicialicen, a veces sin log
npm run build
npx iwsdk dev up
```

Luego **`browser_screenshot` contra el runtime**. El render del **editor no
ejecuta los sistemas de la app**, así que `scene_screenshot` nunca puede probar
que algo *se comporta*. `renderStats.visibleNodeIds` es el detector de fallos
silenciosos: un nodo que no aparece ahí no se renderizó, aunque `valid` sea true.

MCP y CLI son la misma superficie (`scene_render_file` ≡ `npx iwsdk scene
render-file`). MCP para llamadas sueltas y para recibir la imagen inline; CLI
para bucles, scripts y respuestas grandes que conviene filtrar.

### Convenciones

- Sistemas con queries, nunca arrays de entidades a mano.
- **Nunca asignar memoria en `update()`.** Preasignar en `init()` como
  propiedades de clase.
- `signal.peek()` en `update()`; `.value` añade suscripción por frame.
- Toda suscripción se desregistra en `this.cleanupFuncs`.
- Assets por `AssetManager`/manifiesto, nunca un `GLTFLoader` crudo.
- Entidades con `world.createTransformEntity()`, nunca `scene.add()`.
- `RayInteractable`, nunca un `Raycaster` manual.
- VR apunta a 72–90 fps: 11–14 ms por frame. Una asignación por frame es un bug.

### Dónde mirar

| | |
| --- | --- |
| `CLAUDE.md` | Convenciones de IWSDK y tabla de fallos silenciosos |
| `AGENTS.md` | Copia neutral del anterior para otros agentes |
| `.claude/rules/` | Reglas por ruta: `assets-and-manifest`, `ecs-api`, `scene-json`, `uikitml`. Se cargan solas al tocar los archivos que cubren |
| `.claude/skills/` | `iwsdk-scene-composer`, `iwsdk-ui`, `iwsdk-grab`, `iwsdk-ray`, `iwsdk-physics`, `iwsdk-debug`, `iwsdk-depth-occlusion`, `iwsdk-planner`, `iwsdk-art-direction` |
| `docs/` | Plan de cambio de pintura (aprobado, sin implementar) |
| `README.md` | Cara pública del proyecto |

**Antes de improvisar en un dominio que ya tiene skill, invoca el skill.** El
fallo que más caro sale es escribir JSON de escena, un panel UIKitML, un cuerpo
físico o un pase de iluminación a mano porque el enfoque ingenuo parecía viable.

### Controles

| Entrada | Acción |
| --- | --- |
| **A** derecha | Auto siguiente |
| **B** derecha | Entrar / salir del asiento |
| **X** izquierda | Girar la tarima |
| **Y** izquierda | Abrir / cerrar puertas |
| Sticks | Locomoción — **no tocarlos** |
| Panel *Prev* | Auto anterior |

En navegador: **←/→** cambian de auto, **R** gira, **E** puertas, **B** asiento.

---

## 10. Cosas sueltas que conviene saber

- **No hay `LICENSE`.** Los modelos son descargas de terceros con sus propias
  licencias.
- **Los `.glb` originales pesan ~136 MB y están versionados.** Los optimizados
  se generan y están ignorados.
- **Los `.mp3` no están en el repo** (música comercial, repo público). Se dejan
  en `public/audio/music/` y se corre `npm run music`.
- `RobotSystem`, y los assets `robot` / `environment-desk` / `plant-sansevieria`
  / `webxr-banner`, son restos del scaffold. Son `lazy`, así que no cuestan nada
  en runtime, pero son código muerto.
- La lección general del proyecto: casi todo lo que se arregló —los 3.4 GB, las
  sombras apagadas, los autos de tamaños distintos, las calcomanías
  descentrando modelos— era **invisible leyendo el código y evidente en cuanto
  hubo números**. Mide antes de tocar.
