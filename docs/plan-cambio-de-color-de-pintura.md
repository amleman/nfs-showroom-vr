# Cambiar el color de pintura del auto

> **Estado:** plan aprobado, **sin implementar**. Nada de este documento está
> escrito todavía en `src/`. Es el punto de retomada.
>
> Los nombres de material de la tabla se midieron leyendo los `.glb` directamente,
> así que son exactos: se pueden usar tal cual sin volver a investigar.
>
> Rama de trabajo: `feat/car-carousel-audio-and-memory` (PR #1).

## Context

Queremos que el visitante pueda repintar el auto en exhibición desde el panel del
showroom, como en un configurador real.

Lo investigué antes de planear, y el hallazgo importante es que **el trabajo no
está en el código sino en los datos**. Cambiar un color es una línea
(`material.color.set()`); lo difícil es saber *cuál* de los 10–79 materiales de
cada `.glb` es la carrocería. Los ocho modelos vienen de autores distintos sin
convención común, y probé la vía automática (tomar el material con más
triángulos) — **falla en 5 de 7**, porque rines y tornillos tienen más triángulos
que la carrocería.

Medición por modelo:

| Modelo | Material de pintura | Estado |
| --- | --- | --- |
| Camaro SS 350 | `CarPaint` — plano, rgb(0.00, 0.10, 0.54) | Repintado limpio |
| Bugatti EB110 | `Bugatti_EB110SS_By_Alex_Ka` — plano, blanco | Repintado limpio |
| Ferrari 550 | `Ferrari_550_Barchetta_Pininfarina_2000_by_AlexKa` — plano, celeste | Repintado limpio |
| Charger Daytona | `Dodge_Charger_Daytona_by_Alex_Ka` — plano, rojo oscuro | Repintado limpio |
| M3 GTR Razor | `CARSKIN_SKIN1.002` — **con textura** (vinilo NFS) | Solo teñido |
| Dodge pickup | `texture_2__X_Mas_body_color` — **con textura** | Solo teñido |
| M3 GTR Black | 10 materiales, **todos sin nombre** | Identificación manual |
| Jiotto Caspita | 58 materiales, **todos sin nombre** | Identificación manual |

**Alcance decidido:** solo los cuatro de pintura plana. En los texturizados,
`material.color` *multiplica* la textura: el vinilo azul/blanco del Razor se
teñiría en vez de repintarse, que no es lo que se busca. Los otros cuatro autos
simplemente no ofrecen el control.

## Enfoque

Declaración explícita por auto en el catálogo. Nada de heurísticas: ya comprobé
que no funcionan, y una declaración explícita es además la que sobrevive cuando
agregues un modelo nuevo.

### 1. `src/car-catalog.ts`

Agregar campo opcional a `CarEntry`:

```ts
/** Nombre del material de carrocería. Ausente = este auto no se puede repintar. */
paintMaterial?: string;
```

Declararlo en las cuatro entradas con los nombres exactos de la tabla de arriba.
Las otras cuatro se quedan sin el campo y el control se desactiva solo.

### 2. `src/car-finish.ts`

Agregar `setCarPaint(root: Object3D, materialName: string, colorHex: string): boolean`.

Reutiliza la misma forma de recorrido que ya usa `polishCarMaterials` (traverse →
`(object as Mesh).material` → manejar array o único). Devuelve `false` si no
encontró el material, para registrarlo en consola en vez de fallar en silencio.

Dos detalles que no son opcionales:

- **No** debe pasar por el `WeakSet` `polished`. Ese existe para pulir una sola
  vez; el color se reaplica en cada montaje.
- Antes de la primera mutación, guardar el color de fábrica en un
  `WeakMap<Material, Color>` — mismo idioma que el `WeakSet` de al lado. Como la
  escena montada **es** la entrada de caché (confirmado: `loadGLTFById` resuelve
  el objeto cacheado directo, no un clon), escribir `material.color` borra el
  color autoral de forma irreversible en la sesión. Sin el snapshot no hay
  "volver al original".

Descartado: clonar el material de pintura en vez de mutarlo. Sería más limpio en
teoría, pero `disposeHierarchy` libera lo que cuelga de las mallas — el clon sí
se liberaría y **el material original cacheado quedaría filtrado**, porque ya no
lo referencia nadie bajo la raíz. Mutar en sitio con snapshot es lo correcto
aquí, y es defendible porque estos autos tienen una sola instancia viva.

### 3. `src/car-swapper.ts`

- Guardar los colores elegidos en un `Map<assetId, string>` propio del sistema.
  Esto es lo que hace el comportamiento determinista: los materiales que mutamos
  son los **de la caché del AssetManager** (usamos `gltf.scene` directo, no un
  clon), así que el color sobrevive mientras el auto siga residente, pero se
  pierde si el LRU lo expulsa y se vuelve a descargar. Reaplicar desde el mapa en
  cada montaje elimina esa inconsistencia.
- En `mountCurrent`, después de `polishCarMaterials`, aplicar el color guardado.
- Exponer `setPaint(colorHex)`, y señales `paintable` y `paintColor` para la UI,
  siguiendo el patrón de las señales que ya existen (`activeLabel`, `loading`).
- En `startAnimations`/montaje, `paintable.value = entry.paintMaterial != null`.

### 4. UI — panel nuevo, no una fila nueva

**Recomendación: un panel aparte**, `public/ui/paint_picker.uikitml` + nodo
`paint-panel` en la escena con `RayInteractable`, y `src/paint-panel.ts`
siguiendo el patrón de `CarSelectorPanelSystem`.

El motivo es concreto: el panel actual mide 340px y ya lleva tres botones de
92px, así que las muestras no caben en su fila. Y meterlas en una **fila nueva
debajo** es exactamente el caso que ya sabemos que se renderiza y resuelve bien
pero **nunca recibe clics de ray** — nos costó una sesión con el botón "Girar", y
está anotado en el encabezado de los dos `.uikitml`. Un panel propio con una sola
fila es el patrón que sí está probado: es literalmente cómo funciona el panel de
música.

Contenido: una fila de ~5 muestras (blanco, negro, rojo, azul, naranja) como
`div` con `background-color`, `border-radius`, y `id` propio. Estado
seleccionado con `borderColor` — `setProperties` ya lo aplica en runtime, igual
que hace el punto de carga.

Wiring idéntico al probado: `getSceneObject<UIKitMLAsset>('paint-panel')` →
`getElementById(...)` → `addEventListener('click', ...)` → `swapper.setPaint(...)`,
con cada listener y suscripción en `cleanupFuncs`. Suscribirse a `paintable` para
atenuar el panel con `opacity` cuando el auto no se pueda repintar.

Registrar `PaintPanelSystem` en `src/index.ts` **después** de `CarSwapperSystem`,
que es de quien lee sus señales en `init()`.

Otras dos restricciones ya conocidas: el parser de `<style>` **rechaza
comentarios `/* */`** y tumba la carga del nivel entero, y solo hay un subconjunto
de CSS verificado (`.claude/rules/uikitml.md`) — `background-color`,
`border-radius`, `border-color`, `width`, `height` están todos dentro.

Nota de color: `baseColorFactor` en glTF es lineal, pero `Color.set('#rrggbb')`
en three r181 hace la conversión sRGB→lineal sola. Usar hex directo.

## Verificación

1. `npx tsc --noEmit` y `npm run build`.
2. Con el dev server: recorrer con A hasta cada uno de los cuatro autos planos y
   pulsar cada muestra, comprobando con `browser_screenshot` que la carrocería
   cambia y que **rines, vidrios y neumáticos no**.
3. Ir a un auto no pintable (M3 Razor) y confirmar que la fila queda atenuada.
4. Probar la ruta del LRU: pintar el Camaro, avanzar dos autos para forzar la
   expulsión, volver, y confirmar que el color elegido se reaplica.
5. Revisar consola sin errores de parser de UIKitML.

Verificar los clics del panel nuevo **con un ray real** antes de dar la UI por
terminada. Que el panel se dibuje y que `getElementById` resuelva no prueba que
reciba clics — es precisamente el modo en que este proyecto ya nos engañó una vez.

## Esfuerzo

Pequeño. Es sobre todo cableado, y la parte cara —identificar qué material es la
pintura en cada auto— ya está resuelta en la tabla de arriba.

El riesgo real no es el color, son dos cosas de alrededor: que el panel nuevo
reciba clics, y no perder el color de fábrica al mutar la caché. Ambas tienen
mitigación explícita en el plan.
