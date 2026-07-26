import {
  DataBarVertical24Regular,
  DataBarVertical24Filled,
  Home24Regular,
  Home24Filled,
  DocumentBulletList24Regular,
  DocumentBulletList24Filled,
  Settings24Regular,
  Settings24Filled,
} from '@fluentui/react-icons';
import type React from 'react';
import type { TabKey } from './types';

export interface TabDef {
  key: TabKey;
  label: string;
  icon: React.FC<{ fontSize?: number }>;
  iconActive: React.FC<{ fontSize?: number }>;
}

/** The four sections of the app, in tab-bar order. */
export const TABS: TabDef[] = [
  { key: 'usage', label: 'Usage', icon: DataBarVertical24Regular, iconActive: DataBarVertical24Filled },
  { key: 'sites', label: 'Sites', icon: Home24Regular, iconActive: Home24Filled },
  { key: 'plan', label: 'Plan', icon: DocumentBulletList24Regular, iconActive: DocumentBulletList24Filled },
  { key: 'settings', label: 'Settings', icon: Settings24Regular, iconActive: Settings24Filled },
];
