import { EDIT_MODAL_DEBUG, editModalGeometry } from "./EditModalDiagnostics";

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
  let debugFrame = 0;
  const update = () => {
    // Raw coordinate bounds only. CSS intersects the visual viewport with
    // layout height minus Obsidian's live --keyboard-height (no heuristics).
    container.style.setProperty("--private-server-edit-top", `${viewport?.offsetTop ?? 0}px`);
    if (win) {
      container.style.setProperty("--private-server-edit-height", `${viewport?.height ?? win.innerHeight}px`);
      container.style.setProperty("--private-server-edit-layout-height", `${Math.max(win.innerHeight, container.ownerDocument.documentElement?.clientHeight ?? 0)}px`);
    }
    if (EDIT_MODAL_DEBUG && win && !debugFrame) {
      debugFrame = win.requestAnimationFrame(() => {
        debugFrame = 0;
        console.info("[Private Server Edit geometry]", JSON.stringify(editModalGeometry(container, modal, content)));
      });
    }
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  win?.addEventListener("resize", update);
  // The CSS variable responds without JS resize events. Only debug logging
  // observes root changes, so native keyboard updates are captured as well.
  const debugObserver = EDIT_MODAL_DEBUG && typeof MutationObserver !== "undefined"
    ? new MutationObserver(update) : null;
  if (debugObserver) debugObserver.observe(container.ownerDocument.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
  return () => {
    debugObserver?.disconnect();
    if (debugFrame) win?.cancelAnimationFrame(debugFrame);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    win?.removeEventListener("resize", update);
    container.removeClass("private-server-edit-viewport");
    modal.removeClass("private-server-edit-mobile-modal");
    nativeHeader?.removeClass("private-server-edit-native-header");
    container.style.removeProperty("--private-server-edit-top");
    container.style.removeProperty("--private-server-edit-height");
    container.style.removeProperty("--private-server-edit-layout-height");
  };
}
