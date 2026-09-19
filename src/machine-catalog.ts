/**
 * The exhibit floor, in display order.
 *
 * Machines are listed here rather than authored as scene nodes because they load
 * on demand: seven models is ~40 MB and ~1.2 M triangles, far more than a Quest
 * can hold resident in order to show one at a time.
 *
 * Everything a machine needs beyond its geometry is declared here explicitly.
 * That is a decision, not laziness — the predecessor of this file established
 * that deducing anything from a downloaded glTF (which material is the bodywork,
 * which mesh is the floor, how big the thing is meant to be) fails on most
 * models and fails silently. So scale, specifications and inspection points are
 * all authored, and every feature disables itself on a machine that does not
 * declare its data.
 */

/**
 * A machine on the stand.
 *
 * `realHeight` is the single number that makes this a technical tool instead of
 * a toy. Downloads agree on nothing: the excavator is authored 0.117 units long,
 * the tracked vehicle 31 million, and neither carries a unit. So each entry
 * declares the real height in metres of the machine it depicts, and
 * `fitMachineToFloor` scales the measured bounding box to match.
 *
 * Height is the anchor rather than length because a person judges scale against
 * their own body, and because an excavator or a backhoe carries its arm in a
 * pose that makes its overall length meaningless while its cab height is fixed.
 *
 * Specification values are the published figures for the machine named in
 * `reference`. These downloads carry no identity of their own, so the reference
 * is the closest real machine by proportion; the dimensions a visitor sees are
 * measured off what is actually on screen, not quoted from here.
 */
export interface MachineEntry {
  /** Manifest asset id from `src/assets.ts`. */
  assetId: string;
  label: string;
  /** Shown as the eyebrow above the name. */
  category: string;
  /** The real machine whose published data the spec sheet quotes. */
  reference: string;
  /** Real-world height in metres. Drives the 1:1 fit. */
  realHeight: number;
  /** Presentation yaw on the floor, carried by the machine's pivot. */
  yawDeg: number;
  /**
   * Intrinsic correction applied to the model *before* it is measured, for a
   * download whose author left the whole assembly rotated inside the file. An
   * axis-aligned box around a vehicle parked at an angle is much wider than the
   * vehicle, and that inflated width is what the spec panel would quote.
   * `npm run inspect -- <model> <yaw>` is how you find the value: the right one
   * is whichever minimises the reported width.
   */
  alignYawDeg?: number;
  /** Spec sheet rows. Measured dimensions are prepended at runtime. */
  specs: readonly SpecRow[];
  /** Simulated condition monitoring. Labelled as such in the panel. */
  metrics: readonly Metric[];
  /** Inspection and occupational-safety points, in normalised bounds space. */
  hotspots: readonly Hotspot[];
  /** Label for the machine's own animation clip, when it ships one. */
  cycleLabel?: string;
}

export interface SpecRow {
  label: string;
  value: string;
}

/** A monitored value with a 0..1 bar and a colour band. */
export interface Metric {
  label: string;
  value: string;
  /** Bar fill, 0..1. */
  fill: number;
  state: 'ok' | 'watch' | 'due';
}

/**
 * An inspection point anchored to the machine.
 *
 * Positions are **normalised against the fitted bounding box**, not metres: x
 * and z run -1..1 across the width and the length, y runs 0..1 from the floor to
 * the top of the machine. That is what lets one authored point land on the right
 * part of a 1.45 m robot arm and a 7.9 m haul truck without anybody measuring
 * either model, and it survives a later change to `realHeight`.
 */
export interface Hotspot {
  id: string;
  /** SSO = occupational safety, TEC = technical, MTO = maintenance. */
  kind: 'sso' | 'tec' | 'mto';
  title: string;
  /** [x, y, z] in normalised bounds space — see above. */
  anchor: readonly [number, number, number];
  body: string;
}

export const MACHINE_CATALOG: readonly MachineEntry[] = [
  {
    assetId: 'machine-dump-truck',
    label: 'Camion Minero de Acarreo',
    category: 'MINERIA A CIELO ABIERTO',
    reference: 'Clase Komatsu 930E-4',
    // 7.9 m puts the cab deck at roughly four times a person's height, which is
    // the entire reason for showing this machine in VR rather than on a slide.
    realHeight: 7.9,
    yawDeg: 24,
    specs: [
      { label: 'Capacidad de carga', value: '290 t' },
      { label: 'Peso operativo', value: '500 t' },
      { label: 'Capacidad de tolva', value: '172 m3 colmada' },
      { label: 'Potencia', value: '2 013 kW (2 700 hp)' },
      { label: 'Traccion', value: 'Electrica AC, 2 motores de rueda' },
      { label: 'Velocidad maxima', value: '64.5 km/h' },
      { label: 'Neumaticos', value: '59/80R63' },
    ],
    metrics: [
      { label: 'Disponibilidad mecanica', value: '91.4 %', fill: 0.914, state: 'ok' },
      { label: 'Horas desde servicio', value: '412 / 500 h', fill: 0.824, state: 'watch' },
      { label: 'Desgaste de neumaticos', value: '38 %', fill: 0.38, state: 'ok' },
      { label: 'Factor de carga', value: '96 %', fill: 0.96, state: 'ok' },
    ],
    hotspots: [
      {
        id: 'acceso',
        kind: 'sso',
        title: 'Escalera de acceso',
        anchor: [-0.9, 0.45, 0.55],
        body: 'Tres puntos de apoyo obligatorios al subir y bajar. Prohibido transportar herramienta en las manos: use linea de izaje. Caida de altura desde 4 m, arnes requerido en plataforma superior.',
      },
      {
        id: 'punto-ciego',
        kind: 'sso',
        title: 'Punto ciego frontal',
        anchor: [0, 0.12, 0.98],
        body: 'El operador no ve los primeros 12 m frente a la maquina. Nunca cruce por el frente. Contacto visual y autorizacion por radio antes de aproximarse a menos de 30 m.',
      },
      {
        id: 'neumatico',
        kind: 'tec',
        title: 'Neumatico 59/80R63',
        anchor: [-0.92, 0.22, -0.6],
        body: 'Diametro 4.02 m y masa 5.3 t por unidad. Zona de exclusion de 10 m durante el inflado: la energia almacenada equivale a varios kilos de explosivo. Cambio exclusivo con manipulador dedicado.',
      },
      {
        id: 'tolva',
        kind: 'tec',
        title: 'Tolva de acarreo',
        anchor: [0, 0.88, -0.35],
        body: 'Volumen colmado de 172 m3 a 2:1, con revestimiento antidesgaste de acero al manganeso. Verifique adherencia del material antes de descargar en pendiente: la carga pegada desplaza el centro de gravedad.',
      },
      {
        id: 'tren-motriz',
        kind: 'mto',
        title: 'Tren motriz electrico',
        anchor: [0.85, 0.28, -0.85],
        body: 'Dos motores de rueda AC con frenado dinamico por parrilla resistiva. Inspeccion termografica cada 250 h. Bloqueo y etiquetado (LOTO) del bus DC antes de intervenir: 1 500 V residuales.',
      },
    ],
  },
  {
    assetId: 'machine-excavator',
    label: 'Excavadora Hidraulica de Orugas',
    category: 'MOVIMIENTO DE TIERRA',
    reference: 'Clase Caterpillar 336',
    // 5.07 m rather than the 3.9 m this model measures at its own proportions:
    // +30% by eye, asked for on the floor. It is not arbitrary in one respect —
    // anchoring this model on height left it 8.6 m long against 11.2 m for a real
    // CAT 336, so the extra size brings the LENGTH to 11.2 m and it is the height
    // that now reads tall. The model's aspect ratio cannot satisfy both.
    realHeight: 5.07,
    yawDeg: -28,
    specs: [
      { label: 'Peso operativo', value: '36.6 t' },
      { label: 'Potencia neta', value: '234 kW (313 hp)' },
      { label: 'Capacidad de cucharon', value: '1.9 m3' },
      { label: 'Profundidad de excavacion', value: '7.65 m' },
      { label: 'Alcance maximo', value: '10.9 m' },
      { label: 'Fuerza de excavacion', value: '213 kN' },
      { label: 'Presion sobre el suelo', value: '62 kPa' },
    ],
    metrics: [
      { label: 'Disponibilidad mecanica', value: '88.2 %', fill: 0.882, state: 'ok' },
      { label: 'Horas desde servicio', value: '478 / 500 h', fill: 0.956, state: 'due' },
      { label: 'Temperatura hidraulica', value: '78 C', fill: 0.65, state: 'watch' },
      { label: 'Consumo de combustible', value: '24.6 L/h', fill: 0.55, state: 'ok' },
    ],
    hotspots: [
      {
        id: 'radio-giro',
        kind: 'sso',
        title: 'Radio de giro de cola',
        anchor: [0.9, 0.55, -0.55],
        body: 'La superestructura gira fuera del ancho de las orugas. Zona de exclusion igual al radio de giro mas 1 m, senalizada en piso. Ningun trabajador dentro del radio con la maquina energizada.',
      },
      {
        id: 'cabina',
        kind: 'sso',
        title: 'Cabina ROPS / FOPS',
        anchor: [-0.45, 0.78, 0.1],
        body: 'Estructura certificada contra vuelco (ROPS) y contra caida de objetos (FOPS). Cinturon de seguridad obligatorio. Prohibido operar con la puerta abierta o sin reten en el vidrio frontal.',
      },
      {
        id: 'hidraulico',
        kind: 'tec',
        title: 'Circuito hidraulico principal',
        anchor: [0.3, 0.5, 0.35],
        body: 'Dos bombas de pistones con presion de trabajo de 35 MPa. Una fuga a esta presion penetra la piel: localicela siempre con carton, nunca con la mano.',
      },
      {
        id: 'pluma',
        kind: 'tec',
        title: 'Pluma y balancin',
        anchor: [0, 0.62, 0.85],
        body: 'Alcance maximo 10.9 m y profundidad 7.65 m. Nunca desplace la maquina con la pluma extendida fuera del eje de las orugas: el centro de gravedad sale de la base de sustentacion.',
      },
      {
        id: 'orugas',
        kind: 'mto',
        title: 'Tren de rodaje',
        anchor: [-0.85, 0.12, -0.5],
        body: 'Tension de cadena cada 250 h. El tren de rodaje representa hasta el 20 % del costo de operacion: mida elongacion de pasador y desgaste de zapata en lugar de reemplazar por horas.',
      },
    ],
  },
  {
    assetId: 'machine-backhoe',
    label: 'Retroexcavadora Cargadora',
    category: 'OBRA CIVIL E INFRAESTRUCTURA',
    reference: 'Clase JCB 3CX',
    realHeight: 3.61,
    yawDeg: 32,
    specs: [
      { label: 'Peso operativo', value: '8.07 t' },
      { label: 'Potencia', value: '81 kW (109 hp)' },
      { label: 'Capacidad del cargador', value: '1.0 m3' },
      { label: 'Capacidad de la retro', value: '0.24 m3' },
      { label: 'Profundidad de excavacion', value: '5.46 m' },
      { label: 'Altura de descarga', value: '2.74 m' },
      { label: 'Velocidad de traslado', value: '40 km/h' },
    ],
    metrics: [
      { label: 'Disponibilidad mecanica', value: '94.7 %', fill: 0.947, state: 'ok' },
      { label: 'Horas desde servicio', value: '96 / 250 h', fill: 0.384, state: 'ok' },
      { label: 'Horas de operacion', value: '3 420 h', fill: 0.34, state: 'ok' },
      { label: 'Consumo de combustible', value: '8.1 L/h', fill: 0.32, state: 'ok' },
    ],
    hotspots: [
      {
        id: 'estabilizadores',
        kind: 'sso',
        title: 'Gatos estabilizadores',
        anchor: [0.8, 0.12, -0.8],
        body: 'Despliegue obligatorio antes de operar la retro, sobre suelo firme y con placa de apoyo. Sin estabilizadores la maquina vuelca lateralmente al girar con carga.',
      },
      {
        id: 'linea-electrica',
        kind: 'sso',
        title: 'Distancia a lineas energizadas',
        anchor: [0, 1.0, -0.4],
        body: 'Altura maxima de trabajo 5.5 m. Distancia minima de 3 m a lineas de hasta 33 kV, y 5 m por encima. Designe senalero cuando la visual del operador no cubra la pluma.',
      },
      {
        id: 'cargador',
        kind: 'tec',
        title: 'Cucharon cargador frontal',
        anchor: [0, 0.2, 0.92],
        body: 'Capacidad 1.0 m3 y carga de vuelco de 3 200 kg. Traslade siempre con el cucharon a 30 cm del suelo: elevado reduce la estabilidad y bloquea la visual frontal.',
      },
      {
        id: 'retro',
        kind: 'tec',
        title: 'Brazo retroexcavador',
        anchor: [0, 0.55, -0.9],
        body: 'Profundidad de 5.46 m con desplazamiento lateral del brazo para trabajo junto a muro. Fuerza de arranque de 62 kN en el cucharon.',
      },
      {
        id: 'engrase',
        kind: 'mto',
        title: 'Puntos de engrase',
        anchor: [0.55, 0.45, -0.55],
        body: 'Veintiocho graseras en pasadores de pluma y balancin, cada 10 h de operacion. Un pasador sin lubricar genera holgura que se propaga a los bujes y multiplica el costo de reparacion.',
      },
    ],
  },
  {
    assetId: 'machine-robot-arm',
    label: 'Brazo Robotico Industrial',
    category: 'MANUFACTURA Y AUTOMATIZACION',
    reference: 'Clase ABB IRB 4600',
    realHeight: 1.45,
    yawDeg: 18,
    cycleLabel: 'Ciclo de operacion',
    specs: [
      { label: 'Carga util', value: '60 kg' },
      { label: 'Alcance', value: '2.05 m' },
      { label: 'Repetibilidad', value: '+/- 0.05 mm' },
      { label: 'Grados de libertad', value: '6 ejes' },
      { label: 'Peso del robot', value: '435 kg' },
      { label: 'Velocidad eje 1', value: '175 grados/s' },
      { label: 'Proteccion', value: 'IP67, Foundry Plus' },
    ],
    metrics: [
      { label: 'Disponibilidad (uptime)', value: '99.2 %', fill: 0.992, state: 'ok' },
      { label: 'OEE de la celda', value: '84.6 %', fill: 0.846, state: 'watch' },
      { label: 'Ciclos desde servicio', value: '182 k / 250 k', fill: 0.728, state: 'watch' },
      { label: 'Tiempo de ciclo', value: '11.4 s', fill: 0.45, state: 'ok' },
    ],
    hotspots: [
      {
        id: 'celda',
        kind: 'sso',
        title: 'Perimetro de la celda',
        anchor: [0.95, 0.25, 0.7],
        body: 'Envolvente de trabajo de 2.05 m de radio. Cerco fisico con enclavamiento y cortina optica categoria 3. Ninguna persona dentro del perimetro con el robot en modo automatico.',
      },
      {
        id: 'paro',
        kind: 'sso',
        title: 'Paro de emergencia',
        anchor: [-0.8, 0.2, 0.75],
        body: 'Categoria de paro 1 segun IEC 60204-1. Verifique la prueba funcional de la seta y del enclavamiento al inicio de cada turno. Modo manual limitado a 250 mm/s.',
      },
      {
        id: 'muneca',
        kind: 'tec',
        title: 'Muneca y herramienta',
        anchor: [0.15, 0.92, -0.55],
        body: 'Brida ISO 9409-1-A125. Carga util de 60 kg con momento de inercia maximo de 4.5 kg m2. Recalibre el TCP tras cada cambio de herramienta.',
      },
      {
        id: 'eje1',
        kind: 'mto',
        title: 'Reductor del eje 1',
        anchor: [0, 0.18, 0],
        body: 'Reductor cicloidal con cambio de lubricante cada 20 000 h. El analisis de corriente del servo anticipa el desgaste unas 2 000 h antes de que aparezca holgura medible.',
      },
    ],
  },
  {
    assetId: 'machine-precision-arm',
    label: 'Brazo Robotico de Precision',
    category: 'MANUFACTURA MEDICA, SALA LIMPIA',
    reference: 'Clase manipulador quirurgico de 7 ejes',
    realHeight: 2.0,
    yawDeg: -20,
    cycleLabel: 'Secuencia de herramienta',
    specs: [
      { label: 'Carga util', value: '5 kg' },
      { label: 'Grados de libertad', value: '7 ejes por brazo' },
      { label: 'Repetibilidad', value: '+/- 0.02 mm' },
      { label: 'Resolucion de comando', value: '0.01 mm' },
      { label: 'Entorno', value: 'ISO clase 7, sala limpia' },
      { label: 'Esterilizacion', value: 'Interfaz esteril desechable' },
    ],
    metrics: [
      { label: 'Disponibilidad (uptime)', value: '99.7 %', fill: 0.997, state: 'ok' },
      { label: 'Calibracion vigente', value: '54 / 90 dias', fill: 0.6, state: 'watch' },
      { label: 'Usos del instrumento', value: '7 / 10', fill: 0.7, state: 'watch' },
      { label: 'Desviacion de posicion', value: '0.014 mm', fill: 0.28, state: 'ok' },
    ],
    hotspots: [
      {
        id: 'esteril',
        kind: 'sso',
        title: 'Campo esteril',
        anchor: [0, 0.75, 0.6],
        body: 'La barrera esteril se rompe con cualquier contacto no autorizado. Verificacion de integridad de la funda antes de acoplar el instrumento y registro del lote en la bitacora del procedimiento.',
      },
      {
        id: 'colision',
        kind: 'sso',
        title: 'Colision entre brazos',
        anchor: [-0.85, 0.55, -0.2],
        body: 'Los brazos comparten espacio de trabajo. La deteccion de par supervisa colisiones, pero el despeje entre codos se verifica en el posicionamiento inicial, antes de energizar.',
      },
      {
        id: 'instrumento',
        kind: 'tec',
        title: 'Acople del instrumento',
        anchor: [0.4, 0.88, -0.45],
        body: 'Accionamiento por cable con siete grados de libertad en la punta. La vida util esta limitada por numero de usos, contada por el propio instrumento y bloqueada por firmware al agotarse.',
      },
      {
        id: 'encoder',
        kind: 'mto',
        title: 'Encoders y verificacion',
        anchor: [0.2, 0.3, 0.2],
        body: 'Encoders absolutos redundantes por eje. Verificacion metrologica trimestral con patron trazable; una desviacion superior a 0.05 mm saca el equipo de servicio.',
      },
    ],
  },
  {
    assetId: 'machine-service-truck',
    label: 'Camioneta de Servicio Pesado',
    category: 'SOPORTE DE FLOTA',
    reference: 'Clase GMC Sierra 2500HD',
    // 2.37 m rather than the 2.06 m of a real Sierra 2500HD: +15% by eye, asked
    // for so it holds its own beside a 15 m haul truck.
    realHeight: 2.37,
    // 164 rather than 34: +130 counter-clockwise, because the truck presented
    // tail-on to the spawn. The number is large because `alignYawDeg` below
    // squares the model up inside its own file first, and the two rotations
    // compose.
    yawDeg: 164,
    // The download parks the truck at -28.8 degrees inside its own file, which
    // measured 4.87 m across instead of 2.80 m. See `alignYawDeg` above.
    alignYawDeg: 28.8,
    specs: [
      { label: 'Peso bruto vehicular', value: '4.5 t' },
      { label: 'Carga util', value: '1.6 t' },
      { label: 'Capacidad de arrastre', value: '8.4 t' },
      { label: 'Motor', value: '6.6 L diesel, 350 kW (470 hp)' },
      { label: 'Par motor', value: '1 234 N m' },
      { label: 'Traccion', value: '4x4 con caja reductora' },
    ],
    metrics: [
      { label: 'Disponibilidad de flota', value: '96.1 %', fill: 0.961, state: 'ok' },
      { label: 'Km desde servicio', value: '9 200 / 15 000', fill: 0.613, state: 'watch' },
      { label: 'Rendimiento', value: '5.8 km/L', fill: 0.42, state: 'ok' },
      { label: 'Vida util de frenos', value: '61 %', fill: 0.61, state: 'ok' },
    ],
    hotspots: [
      {
        id: 'amarre',
        kind: 'sso',
        title: 'Amarre de carga',
        anchor: [0.6, 0.6, 0.6],
        body: 'Toda carga se asegura a cuatro puntos con tension suficiente para 0.8 g longitudinal. La carga suelta en la caja es la causa mas frecuente de lesion en soporte de flota.',
      },
      {
        id: 'punto-ciego-lateral',
        kind: 'sso',
        title: 'Punto ciego lateral',
        anchor: [-0.95, 0.4, -0.15],
        body: 'Vehiculo de 2.1 m de ancho operando en vias mineras junto a equipo de 9 m. Bandera alta, luz estroboscopica y radio en frecuencia de mina son obligatorios.',
      },
      {
        id: 'remolque',
        kind: 'tec',
        // The marker landed on the front recovery hooks, which is where the
        // model actually has them, so the text covers both ends of the vehicle
        // instead of the marker being moved. The distinction it draws is the
        // point: a recovery hook is not a towing point, and treating it as one
        // is a routine cause of incident.
        title: 'Arrastre y puntos de recuperacion',
        anchor: [0, 0.2, -0.95],
        body: 'Los ganchos delanteros son puntos de RECUPERACION: tiro recto y en linea con el eje del vehiculo, nunca para remolcar ni para izar. La capacidad de arrastre de 8.4 t corresponde al enganche trasero de quinta rueda. Verifique la carga vertical sobre ese enganche: por encima del 15 % del peso remolcado el eje delantero pierde adherencia.',
      },
      {
        id: 'servicio',
        kind: 'mto',
        title: 'Intervalo de servicio',
        anchor: [0, 0.55, -0.55],
        body: 'Servicio cada 15 000 km o al indicar el monitor de vida del aceite. El filtro de particulas diesel exige ciclos de regeneracion: la operacion continua a baja velocidad lo satura.',
      },
    ],
  },
  {
    // Not industrial plant and not the theme of the stand. It is here because it
    // shipped in the model folder and it is the cheapest object in the set to
    // draw. Delete this entry to drop it from the carousel; nothing else
    // references it.
    //
    // It is also the one machine whose 1:1 claim is weakest: the model's own
    // proportions do not match anything in service, and no single choice of
    // `realHeight` or `alignYawDeg` can fix a wrong aspect ratio. See the height
    // note below. Every other machine here lands within a few per cent of its
    // reference.
    assetId: 'machine-tracked-vehicle',
    label: 'Vehiculo Blindado de Oruga',
    category: 'PLATAFORMA PESADA SOBRE ORUGA',
    reference: 'Clase carro de combate principal',
    // 3.75 m against 2.4 m of real turret roof. This model's proportions match
    // nothing in service, so its height was already giving way to get the
    // footprint right; +25% on top of that was asked for by eye on the floor.
    realHeight: 3.75,
    yawDeg: -34,
    specs: [
      { label: 'Peso de combate', value: '55 t' },
      { label: 'Potencia', value: '1 120 kW (1 500 hp)' },
      { label: 'Relacion potencia/peso', value: '20.4 kW/t' },
      { label: 'Presion sobre el suelo', value: '83 kPa' },
      { label: 'Velocidad maxima', value: '68 km/h' },
      { label: 'Autonomia', value: '425 km' },
    ],
    metrics: [
      { label: 'Disponibilidad mecanica', value: '87.5 %', fill: 0.875, state: 'ok' },
      { label: 'Horas desde servicio', value: '210 / 300 h', fill: 0.7, state: 'watch' },
      { label: 'Desgaste de oruga', value: '44 %', fill: 0.44, state: 'ok' },
      { label: 'Consumo', value: '410 L/100 km', fill: 0.82, state: 'watch' },
    ],
    hotspots: [
      {
        id: 'oruga',
        kind: 'sso',
        title: 'Zona de aplastamiento',
        anchor: [-0.95, 0.15, -0.3],
        body: 'Ninguna persona a menos de 2 m de la oruga con el motor en marcha. El operador no tiene visual del costado bajo; el contacto se coordina siempre por el jefe de vehiculo.',
      },
      {
        id: 'suspension',
        kind: 'tec',
        title: 'Suspension de barra de torsion',
        anchor: [0.9, 0.25, 0.1],
        body: 'Barras de torsion transversales con amortiguadores rotativos en las estaciones extremas. Recorrido de rueda superior a 400 mm para mantener contacto a campo traviesa.',
      },
      {
        id: 'tren-rodaje',
        kind: 'mto',
        title: 'Tension del tren de rodaje',
        anchor: [0, 0.18, -0.85],
        body: 'La tension de oruga se verifica en frio antes de cada desplazamiento. Una oruga floja se descarrila en giro cerrado y una tensa consume ruedas motrices de forma acelerada.',
      },
    ],
  },
];
