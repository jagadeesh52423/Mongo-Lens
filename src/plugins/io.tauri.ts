import { BaseDirectory, readTextFile, readDir, mkdir, copyFile, remove, exists } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { homeDir, join } from '@tauri-apps/api/path';
import { PluginFs } from './io';

const PLUGINS_REL = '.mongomacapp/plugins';
const BASE = BaseDirectory.Home;

export async function createTauriPluginFs(): Promise<PluginFs & { pluginsRoot: string }> {
  await mkdir(PLUGINS_REL, { baseDir: BASE, recursive: true });

  // Extract to named variable so recursive copyDir can reference itself without
  // `this` ambiguity under async arrow vs method shorthand contexts.
  const tauriFs: PluginFs & { pluginsRoot: string } = {
    pluginsRoot: PLUGINS_REL,
    async listPluginDirs() {
      const entries = await readDir(PLUGINS_REL, { baseDir: BASE });
      return entries
        .filter(e => e.isDirectory)
        .map(e => `${PLUGINS_REL}/${e.name}`);
    },
    async readManifest(dir) {
      return readTextFile(`${dir}/manifest.json`, { baseDir: BASE });
    },
    async readEntry(p) {
      return readTextFile(p, { baseDir: BASE });
    },
    pluginEntryPath(dir, main) { return `${dir}/${main}`; },
    async copyDir(src, dest) {
      await mkdir(dest, { baseDir: BASE, recursive: true });
      const items = await readDir(src, { baseDir: BASE });
      for (const item of items) {
        const s = `${src}/${item.name}`;
        const d = `${dest}/${item.name}`;
        if (item.isDirectory) await tauriFs.copyDir!(s, d);
        else await copyFile(s, d, { fromPathBaseDir: BASE, toPathBaseDir: BASE });
      }
    },
    async removeDir(dir) {
      await remove(dir, { baseDir: BASE, recursive: true });
    },
    async readPluginFile(dir, relativePath) {
      try {
        return await readTextFile(`${dir}/${relativePath}`, { baseDir: BASE });
      } catch (e) {
        // Only swallow "file not found" — surface permission denied and other
        // I/O errors to the enforcement registry as synthetic findings so the
        // user sees actionable feedback instead of a silent "no README".
        const msg = e instanceof Error ? e.message : String(e);
        if (/no such file|not found|enoent/i.test(msg)) return null;
        throw e;
      }
    },
    async pluginFileUrl(dir, relativePath) {
      try {
        const present = await exists(`${dir}/${relativePath}`, { baseDir: BASE });
        if (!present) return null;
        const home = await homeDir();
        const abs = await join(home, dir, relativePath);
        return convertFileSrc(abs);
      } catch {
        return null;
      }
    },
  };

  return tauriFs;
}
