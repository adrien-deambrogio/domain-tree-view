import type { TFile } from "obsidian";
import type { DomainTreeSettings } from "./settings";

/** A note (file !== null) or an unresolved link target (file === null). */
export interface TreeNode {
	key: string;
	name: string;
	file: TFile | null;
}

export interface Graph {
	nodes: Map<string, TreeNode>;
	children: Map<string, Set<string>>;
	hasParent: Set<string>;
}

export type Comparator = (a: string, b: string) => number;

/**
 * Minimal surface the view needs from the plugin. Using an interface (instead
 * of importing the plugin class) avoids a main.ts <-> view.ts import cycle.
 */
export interface TreeHost {
	settings: DomainTreeSettings;
}
