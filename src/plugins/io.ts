export interface PluginFs {
  listPluginDirs(): Promise<string[]>;
  readManifest(pluginDir: string): Promise<string>;
  readEntry(entryAbsPath: string): Promise<string>;
  pluginEntryPath(pluginDir: string, manifestMain: string): string;
  copyDir?(src: string, dest: string): Promise<void>;
  removeDir?(dir: string): Promise<void>;
  /** Reads an arbitrary file inside the plugin dir; returns null when absent. */
  readPluginFile?(pluginDir: string, relativePath: string): Promise<string | null>;
}
