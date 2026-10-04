import type { App } from "obsidian";
import type { Graph, TreeNode } from "./types";

/* ---------------------------- Link helpers ----------------------------- */

/**
 * Flatten arbitrarily nested YAML values into a string[].
 *
 * `null` and `undefined` are dropped, arrays are flattened recursively,
 * and any other value is converted with `String()`.
 *
 * @example
 * flatten("[[Science]]");                      // ["[[Science]]"]
 * flatten(["[[Math]]", ["[[Physics]]", null]]); // ["[[Math]]", "[[Physics]]"]
 * flatten(null);                               // []
 */
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


/**
 * Build the parent/child graph from frontmatter.
 *
 * Each markdown file becomes a node keyed by its path. A note's
 * `parentsProperty` frontmatter lists links to its parents; each link adds
 * an edge parent -> child. Links that don't resolve to a note become
 * "virtual" nodes (no file) so the child still appears in the tree.
 *
 * Returns:
 * - `nodes`:     key -> node, for real notes and virtual placeholders
 * - `children`:  parent key -> set of child keys (file paths)
 * - `hasParent`: keys of notes with at least one parent (the rest are roots)
 */
export function buildGraph(app: App, parentsProperty: string): Graph {
	const nodes = new Map<string, TreeNode>(); // See `Graph`
	const children = new Map<string, Set<string>>(); // See `Graph`
	const hasParent = new Set<string>(); // See `Graph`

	// Pass 1: one node per markdown file, so parent links can be checked against it.
	const files = app.vault.getMarkdownFiles();
	for (const f of files) {
		nodes.set(f.path, { id: f.path, name: f.basename, file: f });
	}

	// Pass 2: read each note's parent links and record the edges.
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

			// Build parent id
			let parentKey: string;
			if (dest) {
				parentKey = dest.path;
			} else {
				// Unresolved link: get or create a placeholder node with no file.
				// Lowercased key merges spellings; the first-seen casing is displayed.
				parentKey = "virtual:" + link.toLowerCase();
				if (!nodes.has(parentKey)) {
					nodes.set(parentKey, { id: parentKey, name: link, file: null });
				}
			}

			if (parentKey === f.path) continue; // ignore self-parenting
			let set = children.get(parentKey);
			if (!set) children.set(parentKey, (set = new Set()));
			set.add(f.path);
			hasParent.add(f.path);
		}
	}

	return { nodes, children, hasParent };
}