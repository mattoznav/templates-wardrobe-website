/**
 * Responsive images from the Unsplash CDN. Photos are never stored by the
 * shop: the CDN crops and resizes them on request (imgix parameters).
 */

export function img(url: string, width: number, height?: number, quality = 72): string {
  const params = new URLSearchParams({ w: String(width), q: String(quality), auto: "format", fit: "crop" });
  if (height) {
    params.set("h", String(height));
    params.set("crop", "faces,entropy");
  }
  return `${url}?${params}`;
}

/** A srcset for a fixed aspect ratio (width / height). */
export function srcset(url: string, widths: number[], ratio?: number, quality = 72): string {
  return widths.map((w) => `${img(url, w, ratio ? Math.round(w / ratio) : undefined, quality)} ${w}w`).join(", ");
}

export const PORTRAIT = 3 / 4;
