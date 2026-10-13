/** A calendar date (YYYY-MM-DD) at local noon, so formatting never slips a day. */
export const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);
