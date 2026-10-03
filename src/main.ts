import {
  App,
  ItemView,
  Keymap,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
  TFile,
  debounce,
} from "obsidian";

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

const VIEW_TYPE = "domain-tree-view";

interface DomainTreeSettings {
  parentsProperty: string;
  openDepth: number;
  showUnclassified: boolean;
}

const DEFAULT_SETTINGS: DomainTreeSettings = {
  parentsProperty: "parents",
  openDepth: 1,
  showUnclassified: true,
};

/** A note (file !== null) or an unresolved link target (file === null). */
interface TreeNode {
  key: string;
  name: string;
  file: TFile | null;
}

interface Graph {
  nodes: Map<string, TreeNode>;
  children: Map<string, Set<string>>;
  hasParent: Set<string>;
}

type Comparator = (a: string, b: string) => number;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Flatten arbitrarily nested YAML values into a string[]. */
function flatten(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  return [String(value)];
}

/** "[[Science|alias#heading]]" -> "Science" */
function cleanLink(raw: string): string {
  let t = raw.trim();
  const m = t.match(/^\[\[(.+?)\]\]$/);
  const capture = m?.[1];
  if (capture !== undefined) t = capture;
  const [withoutAlias = ""] = t.split("|");
  const [target = ""] = withoutAlias.split("#");
  return target.trim();
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

class DomainTreeView extends ItemView {
  private plugin: DomainTreePlugin;
  private openState = new Map<string, boolean>();
  private filter = "";

  // Persistent DOM (built once in onOpen) and cached graph.
  private host: HTMLElement | null = null;
  private graph: Graph | null = null;
  private byName: Comparator = () => 0;
  private dirty = false;

  constructor(leaf: WorkspaceLeaf, plugin: DomainTreePlugin) {
    super(leaf);
    this.plugin = plugin;
    // FIX 2: don't push tree "navigation" into back/forward history.
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Domain tree";
  }
  getIcon(): string {
    return "list-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("dt-container");
    this.buildToolbar();
    this.refresh(true);

    // FIX 4: refreshes skipped while hidden are applied when shown again.
    const flushIfDirty = (): void => {
      if (this.dirty && this.contentEl.isShown()) this.refresh(true);
    };
    this.registerEvent(this.app.workspace.on("active-leaf-change", flushIfDirty));
    this.registerEvent(this.app.workspace.on("layout-change", flushIfDirty));
  }

  /** FIX 4: toolbar is created once, so the search box keeps focus/caret. */
  private buildToolbar(): void {
    const el = this.contentEl;
    el.empty();

    const bar = el.createDiv({ cls: "dt-toolbar" });
    const search = bar.createEl("input", {
      type: "search",
      placeholder: "Filter…",
      cls: "dt-search",
    });
    search.value = this.filter;
    search.addEventListener("input", () => {
      this.filter = search.value.toLowerCase();
      this.renderTreeOnly();
    });

    const addButton = (label: string, fn: () => void): void => {
      bar.createEl("button", { text: label, cls: "dt-btn" }).addEventListener("click", fn);
    };
    addButton("Expand all", () => this.setAll(true));
    addButton("Collapse all", () => this.setAll(false));
    addButton("Refresh", () => this.refresh(true));

    this.host = el.createDiv({ cls: "dt-tree-host" });
  }

  /** Forget user open/close choices so the depth setting applies again. */
  resetOpenState(): void {
    this.openState.clear();
  }

  /**
   * Rebuild graph + tree (toolbar untouched). Skipped while the view is
   * hidden unless `force` is set; the dirty flag catches it up later.
   */
  refresh(force = false): void {
    if (!force && !this.contentEl.isShown()) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    this.graph = this.buildGraph();
    const nodes = this.graph.nodes;
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    this.byName = (a, b) => collator.compare(nodes.get(a)!.name, nodes.get(b)!.name);
    this.renderTreeOnly();
  }

  /** Re-render the tree from the cached graph, preserving scroll position. */
  private renderTreeOnly(): void {
    if (!this.host || !this.graph) return;
    const scroller = this.contentEl;
    const top = scroller.scrollTop;
    this.renderTree(this.host, this.graph, this.byName);
    scroller.scrollTop = top;
  }

  /** Build the parent/child graph from frontmatter. */
  private buildGraph(): Graph {
    const { app } = this;
    const prop = this.plugin.settings.parentsProperty;
    const nodes = new Map<string, TreeNode>();
    const children = new Map<string, Set<string>>();
    const hasParent = new Set<string>();

    const files = app.vault.getMarkdownFiles();
    for (const f of files) nodes.set(f.path, { key: f.path, name: f.basename, file: f });

    const ensureVirtual = (name: string): string => {
      const key = "virtual:" + name.toLowerCase();
      if (!nodes.has(key)) nodes.set(key, { key, name, file: null });
      return key;
    };

    for (const f of files) {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      for (const item of flatten(fm[prop])) {
        const link = cleanLink(item);
        if (!link) continue;
        const dest = app.metadataCache.getFirstLinkpathDest(link, f.path);
        // FIX 1: a link may resolve to a PDF, image, canvas, etc. Those are
        // not in `nodes`, so using them as keys would crash rendering.
        if (dest && !nodes.has(dest.path)) continue;
        const parentKey = dest ? dest.path : ensureVirtual(link);
        if (parentKey === f.path) continue; // ignore self-parenting
        let set = children.get(parentKey);
        if (!set) children.set(parentKey, (set = new Set()));
        set.add(f.path);
        hasParent.add(f.path);
      }
    }
    return { nodes, children, hasParent };
  }

  private setAll(open: boolean): void {
    if (!this.graph) return;
    this.openState.clear();
    for (const k of this.graph.children.keys()) this.openState.set(k, open);
    this.renderTreeOnly();
  }

  private renderTree(host: HTMLElement, graph: Graph, byName: Comparator): void {
    host.empty();
    const { nodes, children, hasParent } = graph;
    const q = this.filter;

    // Roots: have children but no parent.
    const roots = [...children.keys()].filter((k) => !hasParent.has(k)).sort(byName);

    // Add unreachable groups (pure cycles) so nothing is hidden.
    const reachable = new Set<string>();
    const walk = (k: string): void => {
      if (reachable.has(k)) return;
      reachable.add(k);
      children.get(k)?.forEach(walk);
    };
    roots.forEach(walk);
    for (const k of [...children.keys()].sort(byName)) {
      if (!reachable.has(k)) {
        roots.push(k);
        walk(k);
      }
    }

    // Filter support: keep a branch if it or any descendant matches.
    const matchCache = new Map<string, boolean>();
    const matches = (k: string, seen: Set<string> = new Set()): boolean => {
      if (!q) return true;
      const cached = matchCache.get(k);
      if (cached !== undefined) return cached;
      if (seen.has(k)) return false;
      seen.add(k);
      let r = nodes.get(k)!.name.toLowerCase().includes(q);
      if (!r) {
        for (const c of children.get(k) ?? []) {
          if (matches(c, seen)) {
            r = true;
            break;
          }
        }
      }
      matchCache.set(k, r);
      return r;
    };

    const countDesc = (k: string, seen: Set<string> = new Set()): number => {
      for (const c of children.get(k) ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          countDesc(c, seen);
        }
      }
      return seen.size;
    };

    const ul = host.createEl("ul", { cls: "dt-tree" });
    for (const r of roots) {
      if (matches(r)) this.renderNode(ul, r, graph, byName, matches, countDesc, [], 0);
    }

    if (this.plugin.settings.showUnclassified) {
      const orphans = [...nodes.keys()]
        .filter((k) => nodes.get(k)!.file && !hasParent.has(k) && !children.has(k))
        .filter((k) => !q || nodes.get(k)!.name.toLowerCase().includes(q))
        .sort(byName);
      if (orphans.length) {
        const det = host.createEl("details", { cls: "dt-unclassified" });
        det.createEl("summary", { text: `Unclassified (${orphans.length})` });
        const ul2 = det.createEl("ul", { cls: "dt-tree" });
        for (const k of orphans) this.renderLeaf(ul2.createEl("li"), nodes.get(k)!);
      }
    }

    if (!roots.length) {
      host.createDiv({
        cls: "dt-empty",
        text: `No hierarchy found. Add a "${this.plugin.settings.parentsProperty}" property (list of links) to your notes.`,
      });
    }
  }

  private renderNode(
    ul: HTMLElement,
    key: string,
    graph: Graph,
    byName: Comparator,
    matches: (k: string) => boolean,
    countDesc: (k: string) => number,
    path: string[],
    depth: number
  ): void {
    const node = graph.nodes.get(key)!;
    const kids = [...(graph.children.get(key) ?? [])].filter((c) => matches(c)).sort(byName);
    const li = ul.createEl("li", { cls: "dt-item" });

    if (!kids.length) {
      this.renderLeaf(li, node);
      return;
    }

    const det = li.createEl("details", { cls: "dt-branch" });
    const stored = this.openState.get(key);
    det.open = this.filter
      ? true
      : stored !== undefined
      ? stored
      : depth < this.plugin.settings.openDepth;

    const sum = det.createEl("summary", { cls: "dt-summary" });

    // FIX 3: record *user intent* on click instead of reacting to the async
    // `toggle` event (which also fires for our own programmatic `det.open`
    // assignment and pinned default-open nodes into openState). The click
    // handler runs before the browser toggles, so the new state is !det.open.
    // Link clicks call stopPropagation, so they never reach this handler.
    sum.addEventListener("click", () => {
      if (!this.filter) this.openState.set(key, !det.open);
    });

    this.renderLeaf(sum, node);
    sum.createSpan({ cls: "dt-count", text: ` (${countDesc(key)})` });

    const sub = det.createEl("ul", { cls: "dt-tree" });
    const newPath = [...path, key];
    for (const c of kids) {
      if (newPath.includes(c)) {
        const cli = sub.createEl("li", { cls: "dt-item" });
        this.renderLeaf(cli, graph.nodes.get(c)!);
        cli.createSpan({ cls: "dt-cycle", text: " ↺ cycle" });
      } else {
        this.renderNode(sub, c, graph, byName, matches, countDesc, newPath, depth + 1);
      }
    }
  }

  /**
   * FIX 2: pick a leaf to open notes in that is never this view's own leaf,
   * so clicking a note can't replace the tree.
   */
  private targetLeaf(newLeaf: boolean): WorkspaceLeaf {
    const { workspace } = this.app;
    if (newLeaf) return workspace.getLeaf("tab");
    const leaf = workspace.getLeaf(false);
    return leaf === this.leaf ? workspace.getLeaf("tab") : leaf;
  }

  private renderLeaf(container: HTMLElement, node: TreeNode): void {
    const a = container.createEl("a", {
      text: node.name,
      cls: "dt-link" + (node.file ? "" : " dt-unresolved"),
    });
    a.addEventListener("click", async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // don't toggle <details>
      const newLeaf = Keymap.isModEvent(e);
      if (node.file) {
        await this.targetLeaf(!!newLeaf).openFile(node.file);
      } else {
        await this.app.workspace.openLinkText(node.name, "", !!newLeaf); // creates the note
        this.refresh(true);
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

export default class DomainTreePlugin extends Plugin {
  settings!: DomainTreeSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new DomainTreeView(leaf, this));
    this.addRibbonIcon("list-tree", "Open domain tree", () => void this.activateView());
    this.addCommand({
      id: "open-domain-tree",
      name: "Open domain tree",
      callback: () => void this.activateView(),
    });
    this.addSettingTab(new DomainTreeSettingTab(this.app, this));

    const refresh = debounce(() => this.refreshViews(), 400, true);
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.app.workspace.onLayoutReady(refresh);
  }

  /** Hidden views are only marked dirty; they catch up when shown. */
  refreshViews(resetOpenState = false): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof DomainTreeView) {
        if (resetOpenState) leaf.view.resetOpenState();
        leaf.view.refresh(resetOpenState);
      }
    }
  }

  /** FIX 2: open in the left sidebar, like other tree navigators. */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(resetOpenState = false): Promise<void> {
    await this.saveData(this.settings);
    this.refreshViews(resetOpenState);
  }
}

/* ------------------------------------------------------------------ */
/* Settings tab                                                        */
/* ------------------------------------------------------------------ */

class DomainTreeSettingTab extends PluginSettingTab {
  private plugin: DomainTreePlugin;

  constructor(app: App, plugin: DomainTreePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Parents property")
      .setDesc("Frontmatter property listing a note's parent domains.")
      .addText((t) =>
        t.setValue(this.plugin.settings.parentsProperty).onChange(async (v) => {
          this.plugin.settings.parentsProperty = v.trim() || "parents";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Initially expanded depth")
      .addSlider((s) =>
        s
          .setLimits(0, 6, 1)
          .setValue(this.plugin.settings.openDepth)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.openDepth = v;
            // FIX 3: changing the depth should actually re-apply defaults.
            await this.plugin.saveSettings(true);
          })
      );

    new Setting(containerEl)
      .setName("Show unclassified notes")
      .setDesc("List notes with no parent and no children in a collapsed section.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showUnclassified).onChange(async (v) => {
          this.plugin.settings.showUnclassified = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
