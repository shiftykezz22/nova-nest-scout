// Client-only device detection. Adds classes to <html> so CSS can adapt.
export function detectDevice() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (/(Macintosh)/i.test(ua) && "ontouchend" in document);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const isMobile = isAndroid || isIOS || coarse;

  const root = document.documentElement;
  root.classList.toggle("is-mobile", isMobile);
  root.classList.toggle("is-desktop", !isMobile);
  root.classList.toggle("is-safari", isSafari);
  root.classList.toggle("is-android", isAndroid);
  root.classList.toggle("is-ios", isIOS);

  // eslint-disable-next-line no-console
  console.log("[NovaNest] device detected:", {
    isMobile,
    isDesktop: !isMobile,
    isSafari,
    isAndroid,
    isIOS,
  });
}