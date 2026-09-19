# Contexto del proyecto

Lee este archivo antes de tocar nada. Está escrito para que puedas entender el
proyecto entero sin abrir los demás archivos, y para que sepas dónde mirar
cuando necesites profundizar.

---

## 1. Qué es

**Showroom Industrial VR** — una sala de exhibición de maquinaria industrial en
WebXR para Meta Quest 3, sobre el Immersive Web SDK de Meta. El visitante está
dentro de una galería blanca de 50 × 43 m con 14 m de altura libre, y frente a él
hay una máquina **a escala 1:1 real**: un camión minero de acarreo de 7.9 m de
alto, una excavadora, una retroexcavadora, brazos robóticos. Puede girarla,
cambiar de equipo, cambiar de entorno, y tocar puntos de inspección sobre la
máquina para leer su criterio técnico y de seguridad ocupacional.

**La escala es el producto.** Todo lo demás está subordinado a que un ingeniero
industrial que nunca ha estado junto a un camión de 500 t entienda con su propio
cuerpo lo que significan 7.9 m de alto. Un modelo escalado "a ojo" es un juguete.

Rama: `industrial-showroom`. La rama `main` conserva la versión anterior del
proyecto, que era un showroom de autos estilo *Need for Speed*; nada de aquello
se perdió, simplemente ya no se usa.

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
| Pipeline de modelos | glTF-Transform 4 + sharp + meshoptimizer |
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
- **Importa three desde `@iwsdk/core`, nunca desde `three`.**
- **Geometría estática en TypeScript, composición en JSON.** El JSON de escena
  solo referencia IDs del manifiesto, jamás URLs ni materiales.
- **`entity.dispose()`**, nunca `entity.destroy()` (fuga de VRAM).

---

## 4. Arquitectura

### Flujo de arranque

`src/index.ts` → `World.create(projectOptions)` → registra sistemas en orden
explícito. **El orden importa**: cada uno resuelve al anterior en su `init()`.

```
MachineSwapperSystem        carrusel, carga bajo demanda, LRU, animaciones
MachineTurntableSystem      una vuelta completa con smoothstep, y para
EnvironmentSwitcherSystem   galeria  <->  nave industrial
InspectionHotspotSystem     marcadores 3D sobre la maquina
HotspotCardSystem           tarjeta flotante junto al marcador + linea guia
MachineTitleSystem          rotulo grande sobre la maquina (quad + CanvasTexture)
AmbienceSystem              ruido de sala sintetizado; lo despierta la landing
MachineSelectorPanelSystem  panel selector -> swapper/turntable
SpecPanelSystem             ficha tecnica + boton de entorno
InspectionPanelSystem       lista de puntos + detalle
DesktopNavigationSystem     mirar con el mouse; dormido hasta que la landing lo activa
RenderTuningSystem          foveation + sombras bajo demanda
TurnPivotCapture (-10) / TurnPivotCorrect (+10)   envuelven al TurnSystem interno

`src/landing.ts` no es un sistema: es la pagina 2D de `index.html` que corre
antes de todo y decide por que puerta entra el visitante.
```

### Grafo de escena (`public/scenes/main.iwsdk.scene.json`)

```
showroom-gallery          {LocomotionEnvironment}   visible por defecto
showroom-studio           {LocomotionEnvironment}   escala 3.4, oculto
showroom-stage
└── turntable             ← MachineTurntableSystem rota este nodo
    └── machine-mount     ← la máquina activa y sus marcadores cuelgan aquí
lights-gallery            key + back + top + hemisférica  (blancas, neutras)
lights-studio             key + rim + hemisférica
inspection-panel · machine-selector-panel · machine-specs-panel   {RayInteractable}
hotspot-card              tarjeta flotante; HotspotCardSystem la coloca cada frame
raíz: DomeGradient + IBLGradient · environment: { shadows: true, pcf }
```

**Los sistemas resuelven nodos por su ID de escena**, nunca por índice de
entidad ni por URL. La jerarquía de una máquina montada es:

```
machine-mount → pivot (lleva el yawDeg de presentación) → modelo glTF (ya ajustado)
```

Cada entorno lleva **su propio rig de luces**. Ocultar un grupo oculta también
sus luces (three.js las recoge con `traverseVisible`), así que una sola bandera
de visibilidad por rig es todo el mecanismo del cambio de entorno.

### Datos por máquina — `src/machine-catalog.ts`

Siete máquinas. Cada entrada declara `assetId`, `label`, `category`,
`reference`, **`realHeight`**, `yawDeg`, opcionalmente `alignYawDeg`, y luego
`specs`, `metrics` y `hotspots`. **Sin heurísticas, por decisión explícita**: de
un glTF descargado no se puede deducir nada de forma fiable, y falla en silencio.

---

## 5. La escala 1:1 — cómo funciona realmente

Es la parte del proyecto que hay que entender antes de tocar nada.

Los modelos descargados **no coinciden en nada**. Medidos tal como vienen:

| modelo | largo autorado |
| --- | --- |
| camión minero | 16.7 unidades |
| excavadora | 0.117 unidades |
| vehículo de oruga | 31 000 000 unidades |

Ninguno declara una unidad. No hay nada en el archivo que diga qué tamaño debe
tener. Por eso el catálogo declara **la altura real en metros** y
`fitMachineToFloor` mide el resto:

1. oculta planos de suelo y calcomanías (una malla llega con material `floor`),
2. endereza los modelos Z-up,
3. aplica `alignYawDeg` si el autor dejó el conjunto girado dentro del archivo,
4. escala para que la **altura medida** sea `realHeight`,
5. centra en X/Z y lo asienta en y = 0.

**La altura es el ancla, no el largo**, por dos razones: una persona juzga la
escala contra su propio cuerpo, y una excavadora o una retro llevan el brazo en
una pose que vuelve su largo irrelevante mientras la altura de cabina es fija.

`alignYawDeg` existe porque la camioneta viene estacionada a −28.8° dentro de su
propio archivo: su caja alineada a los ejes medía **4.87 m de ancho** en lugar de
2.80 m, y ese número inflado es el que el panel le habría mostrado al visitante.

**El panel cita las dimensiones medidas del modelo ya ajustado**, no las del
catálogo. Es la única forma de que el número sea honesto.

### Resultado medido (`npm run inspect`)

| máquina | largo | ancho | alto | referencia real |
| --- | --- | --- | --- | --- |
| Camión minero | 15.5 m | 9.0 m | 7.9 m | Komatsu 930E-4: 15.6 × 8.7 × 7.4 |
| Excavadora | 11.2 m | 4.1 m | 5.1 m | CAT 336: largo 11.2 — **+30% pedido** |
| Retroexcavadora | 8.3 m | 2.3 m | 3.6 m | JCB 3CX: ancho 2.35 |
| Camioneta | 7.5 m | 3.2 m | 2.4 m | Sierra 2500HD: largo 6.65 — **+15% pedido** |
| Brazo robótico | 2.1 m | 1.4 m | 1.5 m | ABB IRB 4600: alcance 2.05 |
| Brazo de precisión | 3.7 m | 2.4 m | 2.0 m | manipulador de 7 ejes |
| Vehículo de oruga | 8.9 m | 4.0 m | 3.8 m | **el más flojo** (ver §8), **+25% pedido** |

Tres de esas alturas quedaron por encima de la de su máquina de referencia: se
subieron a ojo a pedido, porque en el piso, junto a un camión de 15 m, las
proporciones correctas leían pequeñas. La ficha sigue siendo internamente
honesta —cita lo que se mide en escena— pero la excavadora, la camioneta y el
vehículo de oruga ya no coinciden con la altura publicada de su referencia. El
de la excavadora es el único que se defiende solo: a +30% su **largo** da justo
los 11.2 m del CAT 336 real.

---

## 6. El pipeline de modelos — por qué existe

`scripts/prepare-models.mjs` reescribe los modelos de
`public/gltf/new_gbl_models/` y `public/gltf/showrooms/` hacia
`public/gltf/industrial/`, que es **generado y gitignoreado**. Resuelve cuatro
problemas, tres de ellos invisibles hasta tener el visor puesto:

1. **IWSDK no tiene decoder de meshopt.** Construye su `GLTFLoader` con DRACO y
   KTX2 y nada más, así que cualquier modelo con `EXT_meshopt_compression`
   simplemente no abre. Dos de los siete lo traían.
2. **El decoder de DRACO se baja de unpkg en tiempo de ejecución.** IWSDK
   hardcodea la ruta del CDN y no la expone en `AssetManager.init`, así que cinco
   de los siete modelos necesitaban internet **en el visor** para abrir. Una
   feria es exactamente donde eso no existe.
3. **Triángulos.** El brazo de precisión traía 1.17 M; ahora 549 k dibujados.
4. **Atributos de vértice inconsistentes en los showrooms.** Ver §7 — es el que
   más caro sale.

La salida va sin ninguna extensión de compresión: archivos más grandes por LAN,
cero dependencias de decoder, nada que descargar. Las texturas ya venían en WebP
y solo se tocan si superan 1024 (color) o 512 (datos).

---

## 7. Trampas encontradas — no las redescubras

### Locomoción y entornos

- **`LocomotionEnvironment` fusiona la geometría del modelo** con
  `BufferGeometryUtils.mergeGeometries` para construir su malla de colisión, y
  **eso revienta si dos primitivas no coinciden en qué atributos tienen**. La
  galería traía UV en 3 de 7 mallas; el estudio traía `TANGENT` y `TEXCOORD_1`
  en una sola. El fallo es silencioso del peor modo: **el modelo se ve perfecto,
  el error queda en consola, y el jugador atraviesa el suelo.**
  `harmoniseAttributes()` en `scripts/prepare-models.mjs` rellena los huecos en
  lugar de quitar los sobrantes, porque quitar `TEXCOORD_1` desmapearía en
  silencio cualquier material que muestree de ahí.

### Assets y memoria

- **`AssetManager.loadGLTFById()` devuelve el objeto cacheado, no un clon.**
  Mutar un material muta la caché para toda la sesión.
- **Excluye `envMap` del barrido de texturas al liberar**: apunta al IBL
  compartido y disponerlo apaga todos los demás materiales.
- **La caché HTTP del navegador gestionado es real.** Si regeneras un `.glb` y el
  error de antes sigue apareciendo, reinicia el dev server (`dev down` + `dev
  up`); un reload normal puede servirte el archivo viejo.

### Render

- **Las sombras están apagadas salvo que el documento de escena las declare.**
  `castShadow` en una luz no hace **nada** sin `environment.shadows: true`.
- **`GLTFLoader` deja todo en `castShadow: false`**, y un modelo cargado por
  `AssetManager` no pasa por la ruta que aplica `content.castShadow`.
- **Una cámara fuera de la sala no renderiza nada y no avisa.** La pared trasera
  de la galería está en z = +21.7; la vista `hero` estaba en z = 22 y devolvía
  una imagen gris vacía.
- **`scene_get_render_stats` falla** ("Cannot read properties of undefined") una
  vez que los marcadores de inspección están en escena. Usa `browser_screenshot`
  y `ecs_find_entities`.

### UIKitML

- **Un panel UIKitML grande puede no renderizar y no avisar.** El rotulo del
  equipo se hizo primero como panel: previsualizaba perfecto en
  `ui_render_preview`, quedaba bien colocado en escena (nodo correcto, hijo del
  asset correcto, transform correcto, `Visibility` en true, cero warnings) y no
  dibujaba nada, a ninguna anchura ni escala de nodo, con y sin
  `RayInteractable`. Se resolvio con un quad y `CanvasTexture`, que ademas si
  admite tildes.
- **La fuente DM Sans empaquetada no tiene `·` ni `—`.** Salen como "Missing
  glyph info" en consola y como huecos en el panel. Tampoco te fíes de los
  acentos: **todo el texto de interfaz está deliberadamente sin tildes.**
- **Un botón en una segunda fila bajo la fila principal se renderiza, y
  `getElementById` lo resuelve, pero nunca recibe clics de ray.** Todos los
  controles en UNA fila, o en un panel aparte. Por eso los paneles nunca ocultan
  una fila: la blanquean, para que la fila de botones no se mueva.
- **El parser de `<style>` rechaza comentarios `/* */`** y eso tumba la carga del
  **nivel entero**, no solo del panel.
- Las medidas numéricas son centímetros. Los paneles son de una cara, hacia +Z.

### Emulador XR

- Las poses de los dispositivos son **relativas al jugador, no al mundo**.
- `xr_set_gamepad_state` (poner el botón a 1 y luego a 0) sí dispara
  `getButtonDown`. Es la forma práctica de recorrer el carrusel sin visor.

---

## 8. Lo que falta o es discutible

- **El vehículo blindado de oruga** no es maquinaria industrial y es la única
  entrada cuya afirmación 1:1 es floja: sus proporciones no coinciden con ningún
  vehículo en servicio. Borra su entrada de `MACHINE_CATALOG` para sacarlo del
  carrusel; nada más lo referencia.
- **Los anclajes de los hotspots están puestos a ojo** en espacio normalizado.
  Caen en la parte correcta de la máquina, pero afinarlos requiere verlos en el
  visor.
- **Las métricas de monitoreo son simuladas** y el panel lo dice.
- **El brazo de precisión se ve rojo.** Puede ser el modelo o puede ser efecto de
  haberle quitado `KHR_materials_transmission`. Sin revisar.
- Los paneles están colocados a ojo delante del spawn; se mueven en el editor.

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
que algo *se comporta*.

### Scripts

| | |
| --- | --- |
| `npm run dev` | Dev server gestionado (corre `models` antes) |
| `npm run models` | Prepara los modelos (incremental; `models:force` rehace todo) |
| `npm run inspect` | Reporta las dimensiones 1:1 de cada máquina ya ajustada |
| `npm run typecheck` | `tsc --noEmit` |

`npm run inspect -- gmc_sierra 28.8` prueba un `alignYawDeg` candidato: el bueno
es el que minimiza el ancho reportado.

### Convenciones

- Sistemas con queries, nunca arrays de entidades a mano.
- **Nunca asignar memoria en `update()`.** Preasignar en `init()`.
- `signal.peek()` en `update()`; `.value` añade suscripción por frame.
- Toda suscripción se desregistra en `this.cleanupFuncs`.
- Assets por `AssetManager`/manifiesto, nunca un `GLTFLoader` crudo.
- Entidades con `world.createTransformEntity()`, nunca `scene.add()`.
- `RayInteractable`, nunca un `Raycaster` manual.
- VR apunta a 72–90 fps: 11–14 ms por frame.

### Controles

| Entrada | Acción |
| --- | --- |
| **A** derecha | Equipo siguiente |
| **B** derecha | Equipo anterior |
| **X** izquierda | Una vuelta completa de la máquina |
| **Y** izquierda | Animar / pausar la máquina, si trae animación |
| Sticks | Locomoción |
| Panel *Cambiar entorno* | Galería ↔ nave industrial |
| Panel *Animar* | Play/pausa de la animación (se atenúa si no hay) |
| Botones SSO/TEC/MTO | Punto de inspección |

En navegador la experiencia es en primera persona, sin visor: **W A S D** o las
flechas caminan, **arrastrar con el mouse** mira, **Q / E** cambian de equipo,
**R** da una vuelta, **F** anima, **T** cambia de entorno, **M** silencia el
sonido, **Esc** vuelve a la landing. Las flechas pasaron a ser locomoción, y por eso el carrusel se movió a
Q/E y la animación de E a F.

---

## 11. Las dos puertas de entrada

`index.html` ya no es un contenedor vacío: es una landing 2D con parallax que
explica el proyecto, con el canvas del showroom renderizando detrás. Ofrece dos
puertas y no esconde ninguna:

- **Pruébalo en XR** — `world.launchXR()`. Se deshabilita con una explicación
  cuando `navigator.xr.isSessionSupported('immersive-vr')` dice que no, en lugar
  de desaparecer: un control escondido se lee como página rota.
- **Explorar en el navegador** — oculta la landing y despierta
  `DesktopNavigationSystem`. Cuando no hay visor, esta pasa a ser la principal.

Eso es lo que resuelve el caso de GitHub Pages. La mitad del trabajo ya venía en
IWSDK y solo había que encenderla: `locomotion.browserControls` en
`iwsdk.config.json` ata WASD a las mismas acciones que el thumbstick, y fuera de
sesión XR el locomotor toma su referencia de `world.camera`. Lo único que
faltaba era el mouse, que es todo lo que agrega `DesktopNavigationSystem`.

Dos detalles que no son obvios:

- **La vista `hero` se aplica una sola vez**, al cargar el nivel, y nunca se
  vuelve a imponer. Por eso la cámara se puede tomar prestada sin pelear. Aun
  así el sistema reescribe la posición local de la cámara **cada frame**, para
  que una recarga de nivel no deje al visitante flotando en el punto de vista de
  la cámara hero.
- **Mientras la landing está arriba, el canvas no recibe eventos de puntero**
  (`pointer-events: none`), o el gesto de scroll se lo come el canvas.

---

## 10. Cosas sueltas que conviene saber

- **No hay `LICENSE`.** Los modelos son descargas de terceros (Sketchfab,
  CC-BY-4.0 en los que declaran licencia) con sus propias condiciones.
- Solo dos máquinas traen animación: el brazo robótico industrial (un clip) y el
  de precisión (cuatro, uno por herramienta). El botón *Ciclo* se atenúa solo en
  las demás.
- La lección general del proyecto sigue siendo la misma que en su versión
  anterior: casi todo lo que se arregló era **invisible leyendo el código y
  evidente en cuanto hubo números**. Mide antes de tocar.
