/** Formatting shared by pages (build time) and scripts (browser). */

const LOCALE = "en-GB";

export function money(amount: string | number, currency: string): string {
  const value = Number(amount);
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function longDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" }).format(new Date(iso));
}

export function deliveryWindow(daysMin: number, daysMax: number): string {
  if (daysMax <= 1) return daysMin === 0 ? "Today" : "Next working day";
  return `${daysMin} to ${daysMax} working days`;
}

const regionNames = new Intl.DisplayNames([LOCALE], { type: "region" });

export function country(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
