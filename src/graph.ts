import type { App } from "obsidian";
import type { Graph, TreeNode } from "./types";

/* ---------------------------- Link helpers ----------------------------- */

/** Flatten arbitrarily nested YAML values into a string[]. */
export function flatten(value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value.flatMap(flatten);
	return [String(value)];
}

/** "[[Science|alias#heading]]" -> "Science" */
export function cleanLink(raw: string): string {
	let t = raw.trim();
	const m = t.match(/^\[\[(.+?)\]\]$/);
	const capture = m?.[1];
	if (capture !== undefined) t = capture;
	const [withoutAlias = ""] = t.split("|");
	const [target = ""] = withoutAlias.split("#");
	return target.trim();
}

/* ------------------------------- Graph --------------------------------- */

/** Look up a node that is known to exist; throws on a programming error. */
export function getNode(graph: Graph, key: string): TreeNode {
	const node = graph.nodes.get(key);
	if (!node) throw new Error(`Domain tree: unknown node "${key}"`);
	return node;
}

/** Build the parent/child graph from frontmatter. */
export function buildGraph(app: App, parentsProperty: string): Graph {
	const nodes = new Map<string, TreeNode>();
	const children = new Map<string, Set<string>>();
	const hasParent = new Set<string>();

	const files = app.vault.getMarkdownFiles();
	for (const f of files) {
		nodes.set(f.path, { key: f.path, name: f.basename, file: f });
	}

	const ensureVirtual = (name: string): string => {
		const key = "virtual:" + name.toLowerCase();
		if (!nodes.has(key)) nodes.set(key, { key, name, file: null });
		return key;
	};

	for (const f of files) {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		if (!fm) continue;
		for (const item of flatten(fm[parentsProperty])) {
			const link = cleanLink(item);
			if (!link) continue;
			const dest = app.metadataCache.getFirstLinkpathDest(link, f.path);
			// A link may resolve to a PDF, image, canvas, etc. Those are not in
			// `nodes`, so using them as keys would break rendering.
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
