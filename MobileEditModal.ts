/** Confirmed in Obsidian's Modal implementation and live desktop DOM:
 * containerEl (.modal-container) > backdrop + modalEl (.modal).
 * modalEl > native close + native header/titleEl + contentEl (.modal-content).
 * Phones add padding to BOTH the native header and contentEl. Keep the native
 * close, hide our unused native header, and own all editing UI in one wrapper.
 */
export function fitMobileEditModal(container: HTMLElement, modal: HTMLElement,
  content: HTMLElement, title: HTMLElement): () => void {
  const nativeHeader = title.parentElement;
  container.addClass("private-server-edit-viewport");
  modal.addClass("private-server-edit-mobile-modal");
  nativeHeader?.addClass("private-server-edit-native-header");
  const win = container.ownerDocument.defaultView;
  const viewport = win?.visualViewport;
  let expandedHeight = 0;
  let viewportWidth = 0;
  const set = (name: string, value: number) => {
    const px = `${Math.max(0, value)}px`;
    if (container.style.getPropertyValue(name) !== px) container.style.setProperty(name, px);
  };
  const update = () => {
    set("--private-server-edit-top", viewport?.offsetTop ?? 0);
    if (!win) return;
    const height = viewport?.height ?? win.innerHeight;
    set("--private-server-edit-height", height);
    // Same contraction heuristic as the working composer; focus alone is not a keyboard.
    if (viewportWidth !== win.innerWidth) { viewportWidth = win.innerWidth; expandedHeight = 0; }
    expandedHeight = Math.max(expandedHeight, win.innerHeight, height);
    const keyboardOpen = !!viewport && Math.abs((viewport.scale ?? 1) - 1) < 0.01
      && expandedHeight - height > Math.max(100, expandedHeight * 0.18);
    // iOS Obsidian WebView may report a VisualViewport boundary that leaves
    // controls adjacent to/partly overlapped by the software keyboard. This is
    // a 24px spacing allowance (six 4px units), NOT an estimate of keyboard height.
    const clearance = keyboardOpen ? 24 : 0;
    set("--private-server-edit-keyboard-clearance", clearance);
    // Subtract measured box chrome, not a guessed keyboard/header allowance.
    // This is a MAXIMUM for the compact wrapper, never a target editor height.
    const chrome = (element: HTMLElement, margins = false) => {
      const style = win.getComputedStyle(element);
      const properties = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth",
        ...(margins ? ["marginTop", "marginBottom"] : [])] as (keyof CSSStyleDeclaration)[];
      return properties.reduce<number>((sum, key) => sum + (parseFloat(String(style[key])) || 0), 0);
    };
    set("--private-server-edit-content-max", height - clearance - chrome(container) - chrome(modal, true) - chrome(content, true));
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  win?.addEventListener("resize", update);
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
  observer?.observe(modal);
  return () => {
    observer?.disconnect();
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    win?.removeEventListener("resize", update);
    container.removeClass("private-server-edit-viewport");
    modal.removeClass("private-server-edit-mobile-modal");
    nativeHeader?.removeClass("private-server-edit-native-header");
    for (const name of ["--private-server-edit-top", "--private-server-edit-height", "--private-server-edit-content-max", "--private-server-edit-keyboard-clearance"]) container.style.removeProperty(name);
  };
}
