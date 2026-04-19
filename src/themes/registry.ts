export interface ThemeDefinition {
  id: string;
  name: string;
  variables: Record<string, string>;
}

const themes: ThemeDefinition[] = [];

export function registerTheme(theme: ThemeDefinition): void {
  const existingIndex = themes.findIndex((t) => t.id === theme.id);
  if (existingIndex >= 0) {
    themes[existingIndex] = theme;
    return;
  }
  themes.push(theme);
}

export function getThemes(): ThemeDefinition[] {
  return themes.slice();
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.find((t) => t.id === id);
}
