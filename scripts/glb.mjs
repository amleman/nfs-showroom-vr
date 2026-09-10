/**
 * Minimal glTF/GLB container read/write, shared by the build scripts.
 *
 * Deliberately not a glTF library. It resolves a model into `{ json, bin }` with
 * every buffer flattened into one, and writes that pair back out as a GLB —
 * which is all `optimize-models.mjs` and `inspect-model.mjs` need, and small
 * enough to keep honest.
 *
 * The one thing worth understanding is `writeGLB`'s contract: it copies every
 * bufferView's bytes verbatim unless you hand it a replacement. That is what
 * keeps accessor `byteOffset`s and `byteStride`s valid without rewriting a
 * single accessor, and it is why the optimizer can swap textures out from under
 * a mesh without touching its geometry.
 */

import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Round up to the 4-byte alignment the GLB spec requires of every chunk. */
export const align4 = (n) => (n + 3) & ~3;

/** Resolve a glTF `uri`, whether it is a data: URI or a sibling file. */
export function readUri(uri, fromFile) {
  if (uri.startsWith('data:')) {
    return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
  }
  return readFileSync(resolve(dirname(fromFile), decodeURIComponent(uri)));
}

/**
 * Read either container into `{ json, bin }` with every buffer resolved.
 *
 * Unpacked glTF may split its data across several `.bin` files and data: URIs;
 * those are concatenated into one buffer and every bufferView is rebased onto
 * it, so callers only ever deal with a single binary blob.
 */
export function readModel(file) {
  const buf = readFileSync(file);

  if (extname(file).toLowerCase() === '.glb') {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) {
      throw new Error('not a GLB');
    }
    const total = view.getUint32(8, true);
    let offset = 12;
    let json = null;
    let bin = Buffer.alloc(0);
    while (offset < total) {
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (type === CHUNK_JSON) {
        json = JSON.parse(buf.subarray(start, start + length).toString('utf8'));
      } else if (type === CHUNK_BIN) {
        bin = buf.subarray(start, start + length);
      }
      offset = start + length;
    }
    return { json, bin };
  }

  const json = JSON.parse(buf.toString('utf8'));
  const parts = [];
  const bases = [];
  let cursor = 0;
  for (const buffer of json.buffers ?? []) {
    const bytes = buffer.uri == null ? Buffer.alloc(0) : readUri(buffer.uri, file);
    bases.push(cursor);
    parts.push(bytes);
    cursor += align4(bytes.length);
    if (bytes.length % 4 !== 0) {
      parts.push(Buffer.alloc(4 - (bytes.length % 4)));
    }
  }
  for (const bufferView of json.bufferViews ?? []) {
    bufferView.byteOffset = (bufferView.byteOffset ?? 0) + bases[bufferView.buffer ?? 0];
    bufferView.buffer = 0;
  }
  return { json, bin: Buffer.concat(parts) };
}

/**
 * Rebuild the binary chunk so bufferViews stay contiguous and correctly aligned,
 * and emit a GLB.
 *
 * `replacements` maps bufferView index to new bytes; every other view is copied
 * verbatim. Mutates `json` (offsets, lengths, `buffers`).
 */
export function writeGLB(json, bin, replacements = new Map()) {
  const parts = [];
  let cursor = 0;
  for (let i = 0; i < (json.bufferViews ?? []).length; i += 1) {
    const view = json.bufferViews[i];
    const replacement = replacements.get(i);
    const bytes =
      replacement ??
      bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const padding = align4(cursor) - cursor;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      cursor += padding;
    }
    view.byteOffset = cursor;
    view.byteLength = bytes.length;
    view.buffer = 0;
    if (replacement != null) {
      // An image view carries no vertex layout; a stale stride would be invalid.
      delete view.byteStride;
    }
    parts.push(bytes);
    cursor += bytes.length;
  }

  const binChunk = Buffer.concat(parts);
  const binPadded = Buffer.concat([
    binChunk,
    Buffer.alloc(align4(binChunk.length) - binChunk.length),
  ]);

  json.buffers = [{ byteLength: binChunk.length }];
  const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.concat([
    jsonChunk,
    Buffer.alloc(align4(jsonChunk.length) - jsonChunk.length, 0x20),
  ]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

// --- node hierarchy ----------------------------------------------------------

/** Column-major 4x4 multiply, `out = a * b`. */
function multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** A glTF node's local matrix, from either `matrix` or its TRS fields. */
function localMatrix(node) {
  if (node.matrix != null) {
    return node.matrix;
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Transform a point by a column-major 4x4. */
export function transformPoint(m, [x, y, z]) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** Column-major yaw rotation, for pre-rotating a model the way the stage does. */
export function rotationY(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/**
 * Walk the default scene, calling `visit(node, worldMatrix, path)` for every
 * node. `path` is the chain of names from the root, which is how a mesh gets
 * identified in a file where only some nodes are named.
 *
 * `rootMatrix` is folded in before any node transform, so a caller can measure
 * the model as it will be posed rather than as it was authored. Folding it in
 * here matters: rotating each node's finished bounding box instead would
 * re-fit an axis-aligned box around an already axis-aligned one and inflate it.
 */
export function traverseScene(json, visit, rootMatrix) {
  const identity = rootMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = json.scenes?.[json.scene ?? 0];
  const walk = (index, parentMatrix, path) => {
    const node = json.nodes?.[index];
    if (node == null) {
      return;
    }
    const world = multiply(parentMatrix, localMatrix(node));
    const here = [...path, node.name ?? `node${index}`];
    visit(node, world, here, index);
    for (const child of node.children ?? []) {
      walk(child, world, here);
    }
  };
  for (const root of scene?.nodes ?? []) {
    walk(root, identity, []);
  }
}
