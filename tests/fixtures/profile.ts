import type { Profile } from '@/types/profile';

/** Test fixture only. Never import from src/. Synthetic values, no real personal data. */
export const ownerProfile: Profile = {
  heightCm: 180,
  dob: '1991-06-15',
  sex: 'male',
  activityLevel: 'light',
  weightLog: [{ date: '2026-01-01', kg: 80 }],
  flaggedAllergens: [],
  conditions: [],
};
