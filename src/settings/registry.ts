import type { ComponentType } from 'react';

export interface SettingSection {
  id: string;
  label: string;
  icon: string;
  component: ComponentType;
}

const sections: SettingSection[] = [];

export function register(section: SettingSection): void {
  const existingIndex = sections.findIndex((s) => s.id === section.id);
  if (existingIndex >= 0) {
    sections[existingIndex] = section;
    return;
  }
  sections.push(section);
}

export function getSections(): SettingSection[] {
  return sections;
}
