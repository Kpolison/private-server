/** Scope visible-viewport sizing to this Edit modal's documented Obsidian elements. */
export function fitMobileEditModal(container: HTMLElement, modal: HTMLElement): () => void {
  container.addClass("private-server-edit-viewport");
  modal.addClass("private-server-edit-mobile-modal");
  const win = container.ownerDocument.defaultView;
  const viewport = win?.visualViewport;
  const update = () => {
    // No keyboard inference or toolbar reservation: use the actual visible bounds.
    container.style.setProperty("--private-server-edit-top", `${viewport?.offsetTop ?? 0}px`);
    if (win) container.style.setProperty("--private-server-edit-height", `${viewport?.height ?? win.innerHeight}px`);
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  win?.addEventListener("resize", update);
  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    win?.removeEventListener("resize", update);
    container.removeClass("private-server-edit-viewport");
    modal.removeClass("private-server-edit-mobile-modal");
    container.style.removeProperty("--private-server-edit-top");
    container.style.removeProperty("--private-server-edit-height");
  };
}
