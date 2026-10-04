import { Plugin, WorkspaceLeaf, debounce } from "obsidian";
import {
	DEFAULT_SETTINGS,
	DomainTreeSettings,
	DomainTreeSettingTab,
} from "./settings";
import { DomainTreeView, VIEW_TYPE } from "./ui/view";

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

	/** Open the tree view in the left sidebar. */
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
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<DomainTreeSettings>,
		);
	}

	async saveSettings(resetOpenState = false): Promise<void> {
		await this.saveData(this.settings);
		this.refreshViews(resetOpenState);
	}
}
