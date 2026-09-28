# Showroom Industrial VR

**Un lugar donde te paras junto a un camión de 500 toneladas, no una diapositiva
que lo describe.**

---

## En una frase

Una aplicación de realidad virtual (WebXR) que muestra maquinaria industrial
pesada a **escala real 1:1** — camiones mineros, excavadoras, retroexcavadoras,
brazos robóticos — con ficha técnica, puntos de inspección y criterios de
seguridad y salud ocupacional directamente sobre el equipo, y que corre tanto en
un visor Meta Quest como en cualquier navegador de escritorio, sin instalar
nada.

## El problema que resuelve

Un neumático de camión minero mide 4 metros de diámetro y pesa más de 5
toneladas. Esa frase es un dato. De pie junto al neumático, es una decisión de
seguridad que se entiende sola.

Enseñar maquinaria pesada — para ventas, para capacitación, para inducción de
seguridad — normalmente se hace con fotos, videos y fichas PDF. Todos esos
formatos comparten un límite: no transmiten la **escala**. Esta aplicación
existe para cruzar ese límite sin tener que llevar la máquina real a ningún
lado.

## Qué hace, concretamente

- **Siete equipos a escala real**, cada uno ajustado a la altura publicada de su
  máquina de referencia: camión de acarreo, excavadora hidráulica,
  retroexcavadora, dos brazos robóticos (industrial y de precisión), una
  camioneta de servicio pesado y un vehículo de oruga. El usuario cambia entre
  ellos sin salir de la escena.
- **Ficha técnica en el aire**, junto a la máquina: capacidad de carga, peso
  operativo, potencia, dimensiones — medidas sobre el modelo que realmente está
  en pantalla, no copiadas de una tabla.
- **Puntos de inspección sobre la propia máquina.** Esferas de color en el
  cuerpo del equipo que, al tocarlas, muestran una tarjeta con el criterio
  técnico, de mantenimiento preventivo o de seguridad y salud ocupacional (SSO)
  de ese punto exacto — el punto ciego frontal de un camión, el radio de giro de
  una excavadora, el enganche de una camioneta.
- **Un rótulo grande** flota sobre cada máquina con su nombre, visible desde
  cualquier ángulo del salón.
- **Dos naves distintas** para exhibir el equipo — una galería blanca de 50×43 m
  y una nave industrial — intercambiables con un botón.
- **Sonido ambiente** sintetizado (aire de nave, zumbido de planta) que sube
  cuando la máquina anima su ciclo, para que el lugar se sienta habitado y no
  como un render silencioso.
- **Landing page propia** antes de entrar: explica el proyecto, muestra el
  catálogo completo con sus dimensiones y dejarte elegir la máquina con la que
  empiezas, todo con el showroom renderizando en vivo detrás.

## Cómo se usa

**Con visor Meta Quest 3** — te pones el equipo, caminas de verdad alrededor de
la máquina, tocas los puntos de inspección con el gatillo o con la mano.

**Sin visor, en cualquier navegador** — caminas con WASD, miras con el mouse,
cambias de equipo con las teclas. Es la misma experiencia, en primera persona,
sin necesidad de hardware especial. Esto importa porque la mayoría de la gente
que reciba un enlace a este proyecto no va a tener un visor puesto: lo va a
abrir en su laptop.

## Por qué existe esta rama

El proyecto nació como un showroom de autos (rama `main`, estética *Need for
Speed*), construido como experimento para probar los límites de la plataforma.
La rama **`industrial-showroom`** es un pivote completo: mismo motor, mismo
patrón de trabajo, pero reorientado por completo hacia un caso de uso real —
presentar equipo industrial pesado para ingeniería, ventas técnicas o
capacitación en seguridad — con datos, criterios técnicos y una interfaz
pensada para eso, no para lucir un auto.

## Stack técnico (para quien vaya a tocar el código)

Construida sobre el **Immersive Web SDK** de Meta (`@iwsdk/core`) y **three.js**,
con TypeScript y Vite. El detalle de arquitectura, decisiones y trampas
encontradas está en [`contexto.md`](contexto.md) — léelo antes de modificar
nada.

---

*Un dato se lee. Una escala se recuerda.*
