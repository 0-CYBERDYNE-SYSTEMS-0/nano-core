export type FFTProfile = 'core';

export interface ProfileDetection {
  source: 'default';
  reason: string;
}

export const FFT_PROFILE: FFTProfile = 'core';
export const PROFILE_DETECTION: ProfileDetection = {
  source: 'default',
  reason: 'nano-core has a single profile',
};
export const FEATURE_FARM = false as const;
