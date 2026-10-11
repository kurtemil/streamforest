/**
 * A playlist image the app may load, or '' for none.
 *
 * Only https. The provider's playlist points thousands of posters at its own
 * servers over plain http (http://Ptv.is:2095/images/…, one of the four streaming
 * servers). On an https page the browser upgrades such a request to https,
 * against a port that only speaks http, so the image can never show — but each
 * attempt still reaches the provider as a malformed request from the home IP. A
 * grid of posters is hundreds of those in seconds, and on 2026-10-10 and 11 the
 * provider's flood protection blocked the home IP on all four servers for hours,
 * taking every stream with it. Dropping them costs no picture that ever showed.
 */
export function safeImageUrl(url: string | undefined | null): string {
  return url && url.startsWith('https://') ? url : ''
}
