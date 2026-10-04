import { ItemView, Keymap, WorkspaceLeaf, debounce } from "obsidian";
import type { PaneType } from "obsidian";
import { buildGraph, getNode } from "../graph";
import type { Comparator, Graph, TreeHost, TreeNode } from "../types";
import { renderTree } from "./render";

export const VIEW_TYPE = "domain-tree-view";

export class DomainTreeView extends ItemView {
	private host: TreeHost;
	/** records which tree nodes the user has manually expanded or collapsed.
	* - Key: a node identifier. In setAll the keys come from this.graph.children.keys(),
	* so they are the node names/ids in the graph.
	* - Value: true if the node is expanded, false if collapsed.
	*/
	private openState = new Map<string, boolean>();
	private filter = "";

	// Persistent DOM (built once in onOpen) and cached graph.
	private treeEl: HTMLElement | null = null;
	private graph: Graph | null = null;
	private byName: Comparator = () => 0;
	private dirty = false;

	constructor(leaf: WorkspaceLeaf, host: TreeHost) {
		super(leaf);
		this.host = host;
		// Don't push tree "navigation" into back/forward history.
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

	onOpen(): Promise<void> {
		this.contentEl.addClass("dt-container");
		this.buildToolbar();
		this.refresh(true);

		// Refreshes skipped while hidden are applied when shown again.
		const flushIfDirty = (): void => {
			if (this.dirty && this.contentEl.isShown()) this.refresh(true);
		};
		this.registerEvent(this.app.workspace.on("active-leaf-change", flushIfDirty));
		this.registerEvent(this.app.workspace.on("layout-change", flushIfDirty));
		return Promise.resolve();
	}

	/** Toolbar is created once, so the search box keeps focus and caret. */
	/** Toolbar is created once, so the search box keeps focus and caret. */
	private buildToolbar(): void {
		const el = this.contentEl;
		el.empty();

		const bar = el.createDiv({ cls: "dt-toolbar" });
		this.addSearchBox(bar);

		this.addToolbarButton(bar, "Expand all", () => this.setAll(true));
		this.addToolbarButton(bar, "Collapse all", () => this.setAll(false));
		this.addToolbarButton(bar, "Refresh", () => this.refresh(true));

		this.treeEl = el.createDiv({ cls: "dt-tree-host" });
	}

	/** Creates the filter input and wires up a debounced handler. */
	private addSearchBox(bar: HTMLElement): HTMLInputElement {
		const search = bar.createEl("input", {
			type: "search",
			placeholder: "Filter…",
			cls: "dt-search",
		});
		search.value = this.filter;

		const applyFilter = debounce(
			() => {
				this.filter = search.value.toLowerCase();
				this.renderTreeOnly();
			},
			150,
			true,
		);
		this.registerDomEvent(search, "input", applyFilter);
		return search;
	}

	/** Adds a button to the toolbar and registers its click handler. */
	private addToolbarButton(bar: HTMLElement, label: string, fn: () => void): HTMLButtonElement {
		const btn = bar.createEl("button", { text: label, cls: "dt-btn" });
		this.registerDomEvent(btn, "click", fn);
		return btn;
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
		const graph = buildGraph(this.app, this.host.settings.parentsProperty);
		this.graph = graph;

		// Creates a comparator that sorts tree nodes by their display name using locale-aware
		// comparison that ignores case and accents.
		const collator = new Intl.Collator(undefined, { sensitivity: "base" });
		this.byName = (a, b) =>
			collator.compare(getNode(graph, a).name, getNode(graph, b).name);
		this.renderTreeOnly();
	}

	/** Re-render the tree from the cached graph, preserving scroll position. */
	private renderTreeOnly(): void {
		if (!this.treeEl || !this.graph) return;
		const scroller = this.contentEl;
		const top = scroller.scrollTop;
		renderTree(this.treeEl, {
			graph: this.graph,
			byName: this.byName,
			filter: this.filter,
			settings: this.host.settings,
			openState: this.openState,
			onOpenNode: (node, evt) => void this.openNode(node, evt),
		});
		scroller.scrollTop = top;
	}

	private setAll(open: boolean): void {
		if (!this.graph) return;
		this.openState.clear();
		for (const k of this.graph.children.keys()) this.openState.set(k, open);
		this.renderTreeOnly();
	}

	/**
	 * Open a tree node in a leaf other than this view's own, so a click never
	 * replaces the tree. Creates the note if it doesn't exist yet.
	 */
	private async openNode(node: TreeNode, evt: MouseEvent): Promise<void> {
		const { workspace } = this.app;
		const mod = Keymap.isModEvent(evt); // PaneType | boolean: Ctrl/Cmd(+Alt) split/tab/window
											// Check `isModEvent` for more info

		// create new file if no existing
		if (!node.file) {
			await workspace.openLinkText(node.name, "", mod);
			this.refresh(true);
			return;
		}

		let leaf = workspace.getLeaf(mod);
		if (!mod && leaf === this.leaf) leaf = workspace.getLeaf("tab"); // Check `getLeaf` for more info
		await leaf.openFile(node.file);
	}
}
