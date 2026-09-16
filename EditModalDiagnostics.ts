// Temporary opt-in: set true, rebuild, then inspect the iPhone Web Inspector console.
// Disabled by default. Logs geometry only, never message text or vault paths.
export const EDIT_MODAL_DEBUG = true;

/** Mirror the CSS intersection for diagnostic reporting and numerical tests. */
export function effectiveEditHeight(layout: number, visualHeight: number, top: number, keyboard: number): number {
  return Math.max(0, Math.min(visualHeight, layout - keyboard - top));
}

export function editModalGeometry(container: HTMLElement, modal: HTMLElement, content: HTMLElement) {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const viewport = win?.visualViewport;
  const wrapper = content.querySelector<HTMLElement>(".private-server-mobile-edit");
  const footer = wrapper?.querySelector<HTMLElement>(".private-server-edit-footer");
  const describe = (element: HTMLElement | null | undefined) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = win?.getComputedStyle(element);
    return {
      tag: element.tagName, classes: element.className,
      rect: { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, width: rect.width },
      scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      css: style ? {
        position: style.position, top: style.top, transform: style.transform,
        height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight,
        display: style.display, flex: style.flex, overflow: style.overflow,
        padding: style.padding, margin: style.margin, border: style.borderWidth,
        gap: style.gap, boxSizing: style.boxSizing
      } : null,
    };
  };
  const rootStyle = win?.getComputedStyle(doc.documentElement);
  const keyboardVariable = rootStyle?.getPropertyValue("--keyboard-height") ?? "";
  const safeAreaVariable = rootStyle?.getPropertyValue("--safe-area-inset-bottom") ?? "";
  const keyboardHeight = Math.max(0, parseFloat(keyboardVariable) || 0);
  const layoutHeight = Math.max(win?.innerHeight ?? 0, doc.documentElement.clientHeight);
  const top = viewport?.offsetTop ?? 0;
  const visualHeight = viewport?.height ?? win?.innerHeight ?? 0;
  const effectiveAvailableHeight = effectiveEditHeight(layoutHeight, visualHeight, top, keyboardHeight);
  const bottom = top + effectiveAvailableHeight;
  const footerBottom = footer?.getBoundingClientRect().bottom;
  return {
    innerHeight: win?.innerHeight, clientHeight: doc.documentElement.clientHeight,
    scrollY: win?.scrollY,
    visualViewport: viewport ? {
      height: viewport.height, offsetTop: viewport.offsetTop,
      pageTop: viewport.pageTop, scale: viewport.scale
    } : null,
    keyboardVariable, safeAreaVariable, keyboardHeight, layoutHeight,
    effectiveAvailableHeight, keyboardBoundary: layoutHeight - keyboardHeight,
    availableBottom: bottom, footerBottom,
    footerWithinKeyboardSafeRegion: footerBottom === undefined ? null : footerBottom <= bottom,
    footerWithinVisibleViewport: footerBottom === undefined ? null : footerBottom <= top + visualHeight,
    overflowPixels: footerBottom === undefined ? null : Math.max(0, footerBottom - bottom),
    html: describe(doc.documentElement), body: describe(doc.body), parent: describe(container.parentElement),
    container: describe(container), modal: describe(modal), content: describe(content),
    wrapper: describe(wrapper), textarea: describe(wrapper?.querySelector<HTMLTextAreaElement>("textarea")),
    footer: describe(footer),
  };
}
