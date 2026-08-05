import { App, PluginSettingTab, Setting } from 'obsidian';
import type HermesPlugin from '../main';
import { DEFAULT_SYSTEM_INSTRUCTION } from '../utils/defaultPrompt';
import type { HudMode, HudTheme } from '../components/HermesHUD';
import { DEFAULT_ASSISTANT_NAME } from '../utils/assistantIdentity';

const AVAILABLE_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

export interface HermesSettings {
  voiceName: string;
  customContext: string;
  systemInstruction: string;
  manualApiKey: string;
  serperApiKey: string;
  chatHistoryFolder: string;
  assistantName: string;
  hudEnabled: boolean;
  hudTheme: HudTheme;
  hudMode: HudMode;
  reactiveGraphEnabled: boolean;
}

export const DEFAULT_HERMES_SETTINGS: HermesSettings = {
  voiceName: 'Zephyr',
  customContext: '',
  systemInstruction: '',
  manualApiKey: '',
  serperApiKey: '',
  chatHistoryFolder: 'chat-history',
  assistantName: DEFAULT_ASSISTANT_NAME,
  hudEnabled: true,
  hudTheme: 'jarvis',
  hudMode: 'strip',
  reactiveGraphEnabled: true,
};

const HUD_THEME_LABELS: Record<HudTheme, string> = {
  jarvis: 'J.A.R.V.I.S cyan',
  gold: 'RN Finance gold',
};

const HUD_MODE_LABELS: Record<HudMode, string> = {
  strip: 'Compact strip',
  full: 'Full panel',
};

export class HermesSettingsTab extends PluginSettingTab {
  plugin: HermesPlugin;

  constructor(app: App, plugin: HermesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.classList.add('hermes-settings');

    ;

    // Voice Selection
    new Setting(containerEl)
      .setName('Voice')
      .setDesc('Select the voice persona for the assistant')
      .addDropdown((dropdown) => {
        AVAILABLE_VOICES.forEach((voice) => {
          dropdown.addOption(voice, voice);
        });
        dropdown
          .setValue(this.plugin.settings?.voiceName || DEFAULT_HERMES_SETTINGS.voiceName)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.voiceName = value;
              await this.plugin.saveSettings();
            }
          });
      });

    // Custom Context
    new Setting(containerEl)
      .setName('Custom context')
      .setDesc('Define specific behaviors or rules for the assistant (added to every session)')
      .addTextArea((text) => {
        text
          .setPlaceholder('Define specific behaviors, personalities, or rules for the AI to follow in all interactions')
          .setValue(this.plugin.settings?.customContext || '')
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.customContext = value;
              await this.plugin.saveSettings();
            }
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 50;
      });

    // System Instructions
    const systemInstructionFragment = document.createDocumentFragment();
    systemInstructionFragment.createSpan({ text: 'Core logic instructions for the ai assistant' });
    systemInstructionFragment.createEl('br');
    const resetLink = systemInstructionFragment.createEl('a', {
      text: 'Reset to default'
    });
    resetLink.addClass('hermes-reset-link');
    resetLink.addEventListener('click', () => {
      if (this.plugin.settings) {
        this.plugin.settings.systemInstruction = DEFAULT_SYSTEM_INSTRUCTION;
        void this.plugin.saveSettings().then(() => {
          // Refresh the settings display to show the updated value
          this.display();
        });
      }
    });

    new Setting(containerEl)
      .setName('System instructions')
      .setDesc(systemInstructionFragment)
      .addTextArea((text) => {
        text
          .setPlaceholder('Core logic instructions')
          .setValue(this.plugin.settings?.systemInstruction || '')
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.systemInstruction = value;
              await this.plugin.saveSettings();
            }
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    // Assistant name
    new Setting(containerEl)
      .setName('Assistant name')
      .setDesc('What you call the assistant. It answers to this name in any language and will not correct you about it. Shown on the HUD too')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_ASSISTANT_NAME)
          .setValue(this.plugin.settings?.assistantName || DEFAULT_ASSISTANT_NAME)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.assistantName = value;
              await this.plugin.saveSettings();
            }
          });
      });

    // HUD Section
    new Setting(containerEl)
      .setName('HUD display')
      .setHeading();

    new Setting(containerEl)
      .setName('Show HUD')
      .setDesc('Animated status ring above the conversation, showing whether Hermes is listening, thinking or speaking')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings?.hudEnabled ?? DEFAULT_HERMES_SETTINGS.hudEnabled)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.hudEnabled = value;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName('HUD colour scheme')
      .setDesc('Palette used for the ring and status text')
      .addDropdown((dropdown) => {
        (Object.keys(HUD_THEME_LABELS) as HudTheme[]).forEach((theme) => {
          dropdown.addOption(theme, HUD_THEME_LABELS[theme]);
        });
        dropdown
          .setValue(this.plugin.settings?.hudTheme || DEFAULT_HERMES_SETTINGS.hudTheme)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.hudTheme = value as HudTheme;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName('HUD layout')
      .setDesc('Compact strip keeps the conversation visible; full panel replaces it. Clicking the ring switches between them too')
      .addDropdown((dropdown) => {
        (Object.keys(HUD_MODE_LABELS) as HudMode[]).forEach((mode) => {
          dropdown.addOption(mode, HUD_MODE_LABELS[mode]);
        });
        dropdown
          .setValue(this.plugin.settings?.hudMode || DEFAULT_HERMES_SETTINGS.hudMode)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.hudMode = value as HudMode;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName('Reactive map')
      .setDesc('Show a live map of the files this conversation has touched, lighting each one up as it is read or searched. Only conversation files are shown, never the whole vault')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings?.reactiveGraphEnabled ?? DEFAULT_HERMES_SETTINGS.reactiveGraphEnabled)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.reactiveGraphEnabled = value;
              await this.plugin.saveSettings();
            }
          });
      });

    // Chat History Folder
    new Setting(containerEl)
      .setName('Chat history folder')
      .setDesc('Folder path where chat history will be saved')
      .addText((text) => {
        text
          .setPlaceholder('Chat history, default chat-history')
          .setValue(this.plugin.settings?.chatHistoryFolder || DEFAULT_HERMES_SETTINGS.chatHistoryFolder)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.chatHistoryFolder = value;
              await this.plugin.saveSettings();
            }
          });
      });

    // API Key Section
    new Setting(containerEl)
      .setName('API authentication')
      .setHeading();

    new Setting(containerEl)
      .setName('Gemini API key')
      .setDesc('Enter your gemini API key for the voice assistant')
      .addText((text) => {
        text
          .setPlaceholder('Enter your gemini API key')
          .setValue(this.plugin.settings?.manualApiKey || '')
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.manualApiKey = value;
              await this.plugin.saveSettings();
            }
          });
        text.inputEl.type = 'password';
      });

    // Serper API key for image search
    const serperFragment = document.createDocumentFragment();
    serperFragment.createSpan({ text: 'API key for image search. Get 2,500 free credits at ' });
    const serperLink = serperFragment.createEl('a', {
      href: 'https://serper.dev/',
      text: 'Serperdev', //skip This is the service's name.
    });
    serperLink.setAttr('target', '_blank');

    new Setting(containerEl)
      .setName('Serper API key')
      .setDesc(serperFragment)
      .addText((text) => {
        text
          .setPlaceholder('Enter your serper API key')
          .setValue(this.plugin.settings?.serperApiKey || '')
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.serperApiKey = value;
              await this.plugin.saveSettings();
            }
          });
        text.inputEl.type = 'password';
      });

    // Documentation link
    const docFragment = document.createDocumentFragment();
    const docText = docFragment.createSpan({ text: 'API keys are handled via manual entry' });
    const docLink = docFragment.createEl('a', {
      href: 'https://ai.google.dev/gemini-api/docs/billing',
      text: 'Learn more about billing.',
    });
    docLink.setAttr('target', '_blank');
    docText.append(docLink);

    new Setting(containerEl)
      .setDesc(docFragment);
  }
}
