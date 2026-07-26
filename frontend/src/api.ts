import axios from 'axios';

/** The backend passes Helen's own error text through as the response body,
 *  which is far more useful than a generic failure message. */
export function errorText(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (typeof data === 'string' && data.trim()) return data;
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Helen localises names and descriptions as `{ en, fi, … }` maps; prefer
 *  English, fall back to Finnish and then to whatever the map holds. */
export function localized(value: Record<string, string> | null | undefined): string {
  if (!value) return '';
  return value.en ?? value.fi ?? Object.values(value)[0] ?? '';
}
