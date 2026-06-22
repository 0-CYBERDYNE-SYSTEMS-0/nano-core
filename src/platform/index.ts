import type { PlatformAdapter } from './types.js';
import { DarwinAdapter } from './darwin.js';
import { LinuxAdapter } from './linux.js';
import { Win32Adapter } from './win32.js';
import { AndroidAdapter } from './android.js';

let cachedAdapter: PlatformAdapter | null = null;

/**
 * Returns the appropriate PlatformAdapter for the current platform.
 * Uses a cached instance to avoid repeated platform detection.
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (cachedAdapter) return cachedAdapter;

  cachedAdapter = detectPlatformAdapter();
  return cachedAdapter;
}

/**
 * Clears the cached platform adapter. Tests that temporarily mutate
 * platform-detection inputs (e.g. PREFIX for Termux detection) should
 * call this so subsequent calls re-evaluate the live environment.
 */
export function resetPlatformAdapterCache(): void {
  cachedAdapter = null;
}

function detectPlatformAdapter(): PlatformAdapter {
  switch (process.platform) {
    case 'darwin':
      return new DarwinAdapter();
    case 'linux':
      // Check if running in Termux on Android
      if (isAndroidTermux()) {
        return new AndroidAdapter();
      }
      return new LinuxAdapter();
    case 'win32':
      return new Win32Adapter();
    case 'android':
      return new AndroidAdapter();
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/**
 * Check if running in Termux on Android
 */
function isAndroidTermux(): boolean {
  // Termux sets PREFIX environment variable
  // and typically has /data/data/com.termux/files/usr as PREFIX
  return (
    process.platform === 'linux' &&
    !!process.env.PREFIX &&
    (process.env.PREFIX.includes('com.termux') ||
      process.env.PREFIX.includes('termux'))
  );
}

export type { PlatformAdapter } from './types.js';
