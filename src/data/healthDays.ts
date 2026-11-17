// The daily health store lives in db.ts with every other store, so the raw connection is never exported.
export { putHealthDay, getHealthDay, healthDaysBetween } from '@/data/db';
