import { Component } from "obsidian";

let drawerSequence = 0;

/** Mobile presentation only. Does not own channel, draft, or message state. */
export class MobileLayout extends Component {
  readonly menu: HTMLButtonElement;
  readonly drawer: HTMLElement;
  readonly backdrop: HTMLButtonElement;
  private closeButton: HTMLButtonElement;
  private opened = false;
  private frame = 0;
  private viewportWidth = 0;
  private expandedHeight = 0;

  constructor(
    private root: HTMLElement,
    layout: HTMLElement,
    sidebar: HTMLElement,
    private main: HTMLElement,
    header: HTMLElement,
  ) {
    super();
    root.addClass("private-server-mobile");
    const id = `private-server-drawer-${++drawerSequence}`;
    this.menu = header.createEl("button", {
      cls: "private-server-drawer-menu", text: "☰",
      attr: { type: "button", "aria-label": "Open channels", title: "Open channels", "aria-controls": id, "aria-expanded": "false" },
    });
    this.menu.onclick = () => this.setOpen(!this.opened);
    this.backdrop = layout.createEl("button", {
      cls: "private-server-drawer-backdrop",
      attr: { type: "button", "aria-label": "Close channels", tabindex: "-1" },
    });
    this.backdrop.hidden = true;
    this.backdrop.onclick = () => this.close();
    this.drawer = layout.createDiv({
      cls: "private-server-drawer",
      attr: { id, role: "dialog", "aria-label": "Personal Discord Server channels", "aria-modal": "true", "aria-hidden": "true" },
    });
    this.drawer.inert = true;
    const drawerHeader = this.drawer.createDiv("private-server-drawer-header");
    drawerHeader.createSpan({ text: "Personal Discord Server" });
    this.closeButton = drawerHeader.createEl("button", {
      text: "×", attr: { type: "button", "aria-label": "Close channels", title: "Close channels" },
    });
    this.closeButton.onclick = () => this.close();
    this.drawer.appendChild(sidebar);
  }

  onload(): void {
    this.registerDomEvent(this.root, "keydown", event => {
      if (!this.opened) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); this.close();
      } else if (event.key === "Tab") {
        // Scoped to this drawer, so Obsidian's channel-creation modal keeps its own focus handling.
        const buttons = Array.from(this.drawer.querySelectorAll<HTMLButtonElement>("button:not([disabled])"))
          .filter(button => button.getClientRects().length > 0);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        const active = this.root.ownerDocument.activeElement;
        if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
      }
    });
    const win = this.root.ownerDocument.defaultView;
    if (!win) return;
    const schedule = () => {
      if (this.frame) return;
      this.frame = win.requestAnimationFrame(() => {
        this.frame = 0;
        this.updateViewport();
      });
    };
    this.registerDomEvent(win, "resize", schedule);
    const viewport = win.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    this.register(() => {
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      if (this.frame) win.cancelAnimationFrame(this.frame);
      this.frame = 0;
    });
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(schedule);
      observer.observe(this.root);
      if (this.root.parentElement) observer.observe(this.root.parentElement);
      this.register(() => observer.disconnect());
    }
    schedule();
  }

  private updateViewport(): void {
    const win = this.root.ownerDocument.defaultView;
    if (!win || !this.root.isConnected) return;
    const viewport = win.visualViewport;
    // Track the largest viewport at this width, including WebViews that resize
    // innerHeight alongside visualViewport. Reset on rotation/window-width changes.
    const width = win.innerWidth;
    if (width !== this.viewportWidth) {
      this.viewportWidth = width;
      this.expandedHeight = 0;
    }
    this.expandedHeight = Math.max(this.expandedHeight, win.innerHeight, viewport?.height ?? 0);
    // A substantial viewport contraction indicates a software keyboard. Small
    // toolbar changes and pinch zoom must not remove the closed-keyboard reserve.
    const keyboardOpen = !!viewport && Math.abs((viewport.scale ?? 1) - 1) < 0.01
      && this.expandedHeight - viewport.height > Math.max(100, this.expandedHeight * 0.18);
    this.root.style.setProperty("--private-server-toolbar-reserve", keyboardOpen ? "0px" : "72px");
    // Obsidian may already resize the parent: max-height is only an additional cap,
    // never a second subtraction of keyboard height from an already resized layout.
    const bottom = viewport ? viewport.offsetTop + viewport.height : win.innerHeight;
    const height = Math.max(0, bottom - this.root.getBoundingClientRect().top);
    const value = `${Math.floor(height)}px`;
    if (this.root.style.getPropertyValue("--private-server-mobile-height") !== value) {
      this.root.style.setProperty("--private-server-mobile-height", value);
    }
  }

  close(): void { this.setOpen(false); }

  private setOpen(open: boolean, restoreFocus = true): void {
    const wasOpen = this.opened;
    this.opened = open;
    this.root.classList.toggle("private-server-drawer-open", open);
    this.menu.setAttribute("aria-expanded", String(open));
    this.drawer.inert = !open;
    this.drawer.setAttribute("aria-hidden", String(!open));
    this.backdrop.hidden = !open;
    this.main.inert = open;
    if (open) {
      this.main.setAttribute("aria-hidden", "true");
      this.closeButton.focus({ preventScroll: true });
    } else {
      this.main.removeAttribute("aria-hidden");
      // Return to the header, not the textarea: closing navigation must not summon the keyboard.
      if (wasOpen && restoreFocus) this.menu.focus({ preventScroll: true });
    }
  }

  resizeComposer(input: HTMLTextAreaElement, feed: HTMLElement): void {
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 64;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    // CSS caps the measured height; longer drafts scroll inside the textarea.
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  onunload(): void {
    this.setOpen(false, false);
    this.root.removeClass("private-server-mobile", "private-server-drawer-open");
    this.root.style.removeProperty("--private-server-mobile-height");
    this.root.style.removeProperty("--private-server-toolbar-reserve");
  }
}
