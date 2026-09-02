/**
 * Scans public/audio/music for tracks and writes playlist.json beside them.
 *
 * Files in public/ are copied verbatim and are not module resources, so Vite's
 * import.meta.glob cannot see them and the browser has no way to list a
 * directory. Generating a manifest at build time is the way the runtime learns
 * what is in the folder.
 *
 * Run it with `npm run music`. It is also wired to predev/prebuild, so simply
 * dropping an mp3 in and restarting the dev server picks it up.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUSIC_DIR = join(PROJECT_ROOT, 'public', 'audio', 'music');
const PLAYLIST_PATH = join(MUSIC_DIR, 'playlist.json');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.m4a', '.aac', '.wav']);

/** "01 - Riders On The Storm.mp3" -> "Riders On The Storm" */
function toTitle(fileName) {
  return fileName
    .slice(0, -extname(fileName).length)
    .replace(/^\d+\s*[-_.]\s*/u, '')
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

let entries = [];
try {
  entries = readdirSync(MUSIC_DIR, { withFileTypes: true });
} catch {
  console.warn(
    `[playlist] ${MUSIC_DIR} does not exist yet — writing an empty playlist.`,
  );
}

const tracks = entries
  .filter(
    (entry) => entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()),
  )
  .map((entry) => entry.name)
  // Stable, predictable order: prefix files with 01_, 02_ to control it.
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((name) => ({
    src: `audio/music/${name}`,
    title: toTitle(name),
  }));

writeFileSync(
  PLAYLIST_PATH,
  `${JSON.stringify({ tracks }, null, 2)}\n`,
  'utf8',
);

console.log(
  `[playlist] wrote ${tracks.length} track(s) to public/audio/music/playlist.json`,
);
for (const track of tracks) {
  console.log(`  - ${track.title}`);
}
