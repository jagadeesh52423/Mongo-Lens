export interface PluginFs {
  listPluginDirs(): Promise<string[]>;
  readManifest(pluginDir: string): Promise<string>;
  readEntry(entryAbsPath: string): Promise<string>;
  pluginEntryPath(pluginDir: string, manifestMain: string): string;
  copyDir?(src: string, dest: string): Promise<void>;
  removeDir?(dir: string): Promise<void>;
}
