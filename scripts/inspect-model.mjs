/**
 * Reports what each machine will actually measure once it is on the floor.
 *
 * `MACHINE_CATALOG` declares one number per machine — its real height in metres
 * — and `fitMachineToFloor` derives everything else from it at load time. That
 * is a good trade, but it means the length and width a visitor reads off the
 * spec panel are a consequence of a number nobody checked against a real
 * machine. This is how you check it without putting the headset on.
 *
 * It reproduces the runtime fit exactly: optional pre-alignment yaw, measure,
 * scale so the height matches, report. Compare the output against the published
 * dimensions of the reference machine in the catalog. A width that comes out
 * half a metre wide usually means the model is authored at an angle inside its
 * own file, which inflates its axis-aligned bounding box — that is what
 * `alignYawDeg` is for, and the second argument here is how you find the value.
 *
 * One caveat: this measures every mesh in the file, while the runtime fit first
 * hides ground planes and shadow-catcher sheets. On a model that ships one, the
 * numbers here come out larger than what the spec panel will show. The tracked
 * vehicle is the only one in this set where the difference is big.
 *
 * Usage:
 *   npm run inspect                       every machine, with catalog values
 *   npm run inspect -- dump_truck         one machine
 *   npm run inspect -- gmc_sierra 28.8    one machine, trying an alignment yaw
 */

import { readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = join(PROJECT_ROOT, 'public', 'gltf', 'industrial');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Must track `src/machine-catalog.ts`. Kept here rather than imported because
 * this is plain Node and the catalog is TypeScript; the cost of the duplication
 * is one line per machine, and a mismatch shows up immediately in the output.
 */
const PLAN = {
  dump_truck: { realHeight: 7.9, alignYawDeg: 0 },
  excavator_cat: { realHeight: 5.07, alignYawDeg: 0 },
  jcb_backhoe_loader: { realHeight: 3.61, alignYawDeg: 0 },
  black_honey_robotic_arm: { realHeight: 1.45, alignYawDeg: 0 },
  medical_robotic_arm: { realHeight: 2.0, alignYawDeg: 0 },
  gmc_sierra_hd2500: { realHeight: 2.37, alignYawDeg: 28.8 },
  simple_tank: { realHeight: 3.75, alignYawDeg: 0 },
};

const CORNERS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Column-major 4x4 multiply, in the same convention glTF stores node matrices. */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function yRotation(degrees) {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function transform(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

async function measure(file, alignYawDeg) {
  const document = await io.read(file);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;

  const walk = (node, parent) => {
    const world = multiply(parent, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh != null) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (position == null) continue;
        const indices = primitive.getIndices();
        triangles += Math.floor(
          (indices?.getCount() ?? position.getCount()) / 3,
        );
        const lo = position.getMin([]);
        const hi = position.getMax([]);
        for (const corner of CORNERS) {
          const point = transform(world, [
            corner & 1 ? hi[0] : lo[0],
            corner & 2 ? hi[1] : lo[1],
            corner & 4 ? hi[2] : lo[2],
          ]);
          for (let i = 0; i < 3; i += 1) {
            min[i] = Math.min(min[i], point[i]);
            max[i] = Math.max(max[i], point[i]);
          }
        }
      }
    }
    for (const child of node.listChildren()) {
      walk(child, world);
    }
  };

  const pre = yRotation(alignYawDeg);
  for (const node of document.getRoot().listScenes()[0].listChildren()) {
    walk(node, pre);
  }
  return { size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], triangles };
}

const [nameFilter, yawOverride] = process.argv.slice(2);
const pad = (n, width, digits = 2) =>
  Number(n).toFixed(digits).padStart(width);

console.log(
  'machine                      align      largo   ancho    alto     escala     tris',
);
for (const file of readdirSync(MODEL_DIR)) {
  if (extname(file).toLowerCase() !== '.glb') continue;
  const stem = basename(file, '.glb');
  const plan = PLAN[stem];
  if (plan == null) continue;
  if (nameFilter != null && !stem.includes(nameFilter)) continue;

  const alignYawDeg =
    yawOverride != null && Number.isFinite(Number(yawOverride))
      ? Number(yawOverride)
      : plan.alignYawDeg;
  const { size, triangles } = await measure(join(MODEL_DIR, file), alignYawDeg);
  const scale = plan.realHeight / size[1];
  const [x, y, z] = size.map((value) => value * scale);
  console.log(
    `${stem.padEnd(26)} ${pad(alignYawDeg, 6, 1)}  ` +
      `${pad(Math.max(x, z), 8)} m ${pad(Math.min(x, z), 6)} m ${pad(y, 6)} m  ` +
      `x${Number(scale).toPrecision(4).padStart(9)}  ${String(triangles).padStart(8)}`,
  );
}
