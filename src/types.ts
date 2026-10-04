import type { TFile } from "obsidian";
import type { DomainTreeSettings } from "./settings";

/** A note (file !== null) or an unresolved link target (file === null). */
export interface TreeNode {
	/** Unique id: the file path for notes (ex: "Notes/Science.md"), 
	 * or "virtual:<lowercased name>" (ex: "virtual:science") for unresolved links. */
	id: string;
	/** Display label: the note's basename, or the link text as first written. */
	name: string;
	file: TFile | null;
}

/** Parent/child relationships built from frontmatter. All keys refer to `nodes`. */
export interface Graph {
	/** Every node, by id. */
	nodes: Map<string, TreeNode>;
	/** Parent id -> keys of its children. Children are always real notes. */
	children: Map<string, Set<string>>;
	/** Keys of notes that have at least one parent. Nodes not in this set are roots. */
	hasParent: Set<string>;
}

/** Compares two node keys (not names) for sorting siblings. */
export type Comparator = (a: string, b: string) => number;

/**
 * Minimal surface the view needs from the plugin. Using an interface (instead
 * of importing the plugin class) avoids a main.ts <-> view.ts import cycle.
 */
export interface TreeHost {
	settings: DomainTreeSettings;
}
