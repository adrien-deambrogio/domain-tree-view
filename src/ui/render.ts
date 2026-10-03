import { getNode } from "../graph";
import type { DomainTreeSettings } from "../settings";
import type { Comparator, Graph, TreeNode } from "../types";

export interface RenderContext {
	graph: Graph;
	byName: Comparator;
	/** Lower-cased filter text ("" = no filter). */
	filter: string;
	settings: DomainTreeSettings;
	/** User open/close choices, keyed by node key. Mutated on click. */
	openState: Map<string, boolean>;
	onOpenNode: (node: TreeNode, evt: MouseEvent) => void;
}

interface RenderState {
	ctx: RenderContext;
	matches: (key: string) => boolean;
	countDesc: (key: string) => number;
}

/**
 * Note on listeners: rows are destroyed and rebuilt on every render, so they
 * use plain addEventListener (they are garbage-collected with their element).
 * registerDomEvent would keep every old callback alive until the view unloads.
 */
export function renderTree(host: HTMLElement, ctx: RenderContext): void {
	host.empty();
	const { graph, byName, filter: q, settings } = ctx;
	const { nodes, children, hasParent } = graph;

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

	const visible = visibleKeys(graph, q);
	const matches = (k: string): boolean => visible === null || visible.has(k);

	const descCache = new Map<string, number>();
	const countDesc = (k: string): number => {
		const cached = descCache.get(k);
		if (cached !== undefined) return cached;
		const seen = new Set<string>();
		const stack = [...(children.get(k) ?? [])];
		while (stack.length) {
			const c = stack.pop();
			if (c === undefined || seen.has(c)) continue;
			seen.add(c);
			for (const g of children.get(c) ?? []) stack.push(g);
		}
		descCache.set(k, seen.size);
		return seen.size;
	};

	const state: RenderState = { ctx, matches, countDesc };

	const ul = host.createEl("ul", { cls: "dt-tree" });
	for (const r of roots) {
		if (matches(r)) renderNode(ul, r, state, [], 0);
	}

	if (settings.showUnclassified) {
		const orphans = [...nodes.values()]
			.filter((n) => n.file && !hasParent.has(n.key) && !children.has(n.key))
			.filter((n) => !q || n.name.toLowerCase().includes(q))
			.map((n) => n.key)
			.sort(byName);
		if (orphans.length) {
			const det = host.createEl("details", { cls: "dt-unclassified" });
			det.createEl("summary", { text: `Unclassified (${orphans.length})` });
			const ul2 = det.createEl("ul", { cls: "dt-tree" });
			for (const k of orphans) renderLeaf(ul2.createEl("li"), getNode(graph, k), ctx);
		}
	}

	if (!roots.length) {
		host.createDiv({
			cls: "dt-empty",
			text: `No hierarchy found. Add a "${settings.parentsProperty}" property (list of links) to your notes.`,
		});
	}
}

/**
 * Keys that match the filter or have a matching descendant, or null when no
 * filter is active. Walks upward from direct matches, so it is linear and
 * safe on cyclic data (no order-dependent caching).
 */
function visibleKeys(graph: Graph, q: string): Set<string> | null {
	if (!q) return null;

	const parentsOf = new Map<string, string[]>();
	for (const [parent, kids] of graph.children) {
		for (const kid of kids) {
			const list = parentsOf.get(kid);
			if (list) list.push(parent);
			else parentsOf.set(kid, [parent]);
		}
	}

	const visible = new Set<string>();
	const stack: string[] = [];
	for (const n of graph.nodes.values()) {
		if (n.name.toLowerCase().includes(q)) stack.push(n.key);
	}
	while (stack.length) {
		const k = stack.pop();
		if (k === undefined || visible.has(k)) continue;
		visible.add(k);
		for (const p of parentsOf.get(k) ?? []) stack.push(p);
	}
	return visible;
}

function renderNode(
	ul: HTMLElement,
	key: string,
	state: RenderState,
	path: string[],
	depth: number,
): void {
	const { ctx, matches, countDesc } = state;
	const { graph, byName, filter, settings, openState } = ctx;

	const node = getNode(graph, key);
	const kids = [...(graph.children.get(key) ?? [])].filter(matches).sort(byName);
	const li = ul.createEl("li", { cls: "dt-item" });

	if (!kids.length) {
		renderLeaf(li, node, ctx);
		return;
	}

	const det = li.createEl("details", { cls: "dt-branch" });
	const stored = openState.get(key);
	det.open = filter ? true : stored !== undefined ? stored : depth < settings.openDepth;

	const sum = det.createEl("summary", { cls: "dt-summary" });

	// Record user intent on click instead of reacting to the async `toggle`
	// event (which also fires for our own programmatic `det.open`). The click
	// handler runs before the browser toggles, so the new state is !det.open.
	// Link clicks call stopPropagation, so they never reach this handler.
	sum.addEventListener("click", () => {
		if (!filter) openState.set(key, !det.open);
	});

	renderLeaf(sum, node, ctx);
	sum.createSpan({ cls: "dt-count", text: ` (${countDesc(key)})` });

	const sub = det.createEl("ul", { cls: "dt-tree" });
	const newPath = [...path, key];
	for (const c of kids) {
		if (newPath.includes(c)) {
			const cli = sub.createEl("li", { cls: "dt-item" });
			renderLeaf(cli, getNode(graph, c), ctx);
			cli.createSpan({ cls: "dt-cycle", text: " ↺ cycle" });
		} else {
			renderNode(sub, c, state, newPath, depth + 1);
		}
	}
}

function renderLeaf(container: HTMLElement, node: TreeNode, ctx: RenderContext): void {
	const a = container.createEl("a", {
		text: node.name,
		cls: "dt-link" + (node.file ? "" : " dt-unresolved"),
	});
	a.addEventListener("click", (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation(); // don't toggle <details>
		ctx.onOpenNode(node, e);
	});
}
