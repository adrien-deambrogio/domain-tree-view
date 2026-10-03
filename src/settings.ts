import { App, PluginSettingTab, Setting, debounce } from "obsidian";
import type DomainTreePlugin from "./main";

export interface DomainTreeSettings {
	parentsProperty: string;
	openDepth: number;
	showUnclassified: boolean;
}

export const DEFAULT_SETTINGS: DomainTreeSettings = {
	parentsProperty: "parents",
	openDepth: 1,
	showUnclassified: true,
};

export class DomainTreeSettingTab extends PluginSettingTab {
	private plugin: DomainTreePlugin;

	constructor(app: App, plugin: DomainTreePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Typing in the text field would otherwise save + rebuild the graph on every keystroke.
		const saveDebounced = debounce(
			() => void this.plugin.saveSettings(),
			500,
			true,
		);

		new Setting(containerEl)
			.setName("Parents property")
			.setDesc("Frontmatter property listing a note's parent domains.")
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.parentsProperty)
					.setValue(this.plugin.settings.parentsProperty)
					.onChange((v) => {
						this.plugin.settings.parentsProperty =
							v.trim() || DEFAULT_SETTINGS.parentsProperty;
						saveDebounced();
					}),
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
						// Re-apply the depth default by forgetting manual open/close choices.
						await this.plugin.saveSettings(true);
					}),
			);

		new Setting(containerEl)
			.setName("Show unclassified notes")
			.setDesc("List notes with no parent and no children in a collapsed section.")
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.showUnclassified)
					.onChange(async (v) => {
						this.plugin.settings.showUnclassified = v;
						await this.plugin.saveSettings();
					}),
			);
	}
}
