import fs from 'fs';
import os from 'os';
import path from 'path';

const HOME_DIR = os.homedir();
const FF_NANO_DIR = path.join(HOME_DIR, '.ff-nano');
const PROFILES_DIR = path.join(FF_NANO_DIR, 'profiles');
const WORKSPACES_DIR = path.join(FF_NANO_DIR, 'workspaces');

export interface ProfileManifest {
  version: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  license: string;
  capabilities: string[];
  config: {
    systemPrompt?: string;
    envVars?: Record<string, string>;
    startupHooks?: string[];
  };
  dependencies?: {
    system?: string[];
    npm?: string[];
  };
}

export function getProfilesDir(): string {
  return PROFILES_DIR;
}

export function getWorkspacesDir(): string {
  return WORKSPACES_DIR;
}

export function getProfileDir(profileName: string): string {
  return path.join(PROFILES_DIR, profileName);
}

export function getWorkspaceDir(profileName: string): string {
  return path.join(WORKSPACES_DIR, profileName);
}

export function getProfileManifest(profileName: string): ProfileManifest | null {
  const manifestPath = path.join(getProfileDir(profileName), 'PROFILE.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content) as ProfileManifest;
  } catch {
    return null;
  }
}

export function listInstalledProfiles(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) {
    return [];
  }
  return fs.readdirSync(PROFILES_DIR).filter(dir => {
    const fullPath = path.join(PROFILES_DIR, dir);
    try {
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });
}

export function ensureDirectories(): void {
  if (!fs.existsSync(FF_NANO_DIR)) {
    fs.mkdirSync(FF_NANO_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
  if (!fs.existsSync(WORKSPACES_DIR)) {
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
}
