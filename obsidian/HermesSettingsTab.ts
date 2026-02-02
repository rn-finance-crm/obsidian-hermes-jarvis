import { App, PluginSettingTab, Setting } from 'obsidian';
import type HermesPlugin from '../main';
import { DEFAULT_SYSTEM_INSTRUCTION } from '../utils/defaultPrompt';
import { GIT_BRANCH, GIT_COMMIT, PLUGIN_VERSION } from '../version';
import { saveAppSettings, loadAppSettings } from '../persistence/persistence';

const AVAILABLE_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

export interface HermesSettings {
  voiceName: string;
  customContext: string;
  systemInstruction: string;
  manualApiKey: string;
  serperApiKey: string;
  perplexityApiKey?: string;
  chatHistoryFolder: string;
  webSearchProvider: 'google' | 'serper' | 'perplexity';
}

export const DEFAULT_HERMES_SETTINGS: HermesSettings = {
  voiceName: 'Zephyr',
  customContext: '',
  systemInstruction: '',
  manualApiKey: '',
  serperApiKey: '',
  perplexityApiKey: '',
  chatHistoryFolder: 'hermes',
  webSearchProvider: 'serper',
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

    // Reload settings from persistence to get latest values
    const freshSettings = loadAppSettings();
    if (freshSettings) {
      this.plugin.settings = { ...this.plugin.settings, ...freshSettings };
    }

    // API Key Section
    new Setting(containerEl)
      .setName('Context and Gemini')
      .setHeading();

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
              await saveAppSettings(this.plugin.settings);
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
              await saveAppSettings(this.plugin.settings);
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
        void saveAppSettings(this.plugin.settings).then(() => {
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
              await saveAppSettings(this.plugin.settings);
            }
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    // API Key Section
    new Setting(containerEl)
      .setName('API keys and authentication')
      .setHeading();

    // Documentation link
    const docFragment = document.createDocumentFragment();
    const docText = docFragment.createSpan({ text: 'Bring your own API keys! ' });
    const docLink = docFragment.createEl('a', {
      href: 'https://ai.google.dev/gemini-api/docs/billing',
      text: `Learn more about billing for google's API`,
    });
    docLink.setAttr('target', '_blank');
    docText.append(docLink);

    new Setting(containerEl)
      .setDesc(docFragment);


    // Get current provider for validation display
    const currentProvider = this.plugin.settings?.webSearchProvider || DEFAULT_HERMES_SETTINGS.webSearchProvider;

    new Setting(containerEl)
      .setName('Gemini API key')
      .setDesc('Required for the gemini live API and search interface. Enter your Gemini API key.')
      .addText((text) => {
        text
          .setPlaceholder('Enter your Gemini API key')
          .setValue(this.plugin.settings?.manualApiKey || '')
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.manualApiKey = value;
              await saveAppSettings(this.plugin.settings);
            }
          });
        text.inputEl.type = 'password';
      });

    // Serper API key for web search
    const serperFragment = document.createDocumentFragment();
    serperFragment.createSpan({ text: currentProvider === 'serper' 
      ? 'Required for Serper.dev search. Get 2,500 free credits at ' 
      : 'Optional for Serper.dev search. I use this, so web searches are below a second, found google is piping it though gemini that makes it extra slow. It is 1 credit per search and you get 2,500 free credits at ' });
    const serperLink = serperFragment.createEl('a', {
      href: 'https://serper.dev/',
      text: 'Serper.dev',
    });
    serperLink.setAttr('target', '_blank');

    const serperSetting = new Setting(containerEl)
      .setName('Serper API key')
      .setDesc(serperFragment)
      .addText((text) => {
        text
          .setPlaceholder('Enter your Serper API key')
          .setValue(this.plugin.settings?.serperApiKey || '')
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.serperApiKey = value;
              await saveAppSettings(this.plugin.settings);
            }
          });
        text.inputEl.type = 'password';
      });

    // Add warning styling if Serper is selected but no API key is set
    if (currentProvider === 'serper' && !this.plugin.settings?.serperApiKey) {
      const warningFragment = document.createDocumentFragment();
      const warningText = warningFragment.createSpan({ 
        text: '⚠️ Warning: Serper.dev is selected but no API key is configured. Web search will not work.' 
      });
      warningText.addClass('hermes-warning-text');
      
      serperSetting.setDesc(warningFragment);
      serperSetting.settingEl.addClass('hermes-setting-warning');
    }


    // Web Search Provider Selection
    new Setting(containerEl)
      .setName('Web search provider')
      .setDesc('Select the default web search provider')
      .addDropdown((dropdown) => {
        dropdown.addOption('google', 'Google (Gemini Search)');
        dropdown.addOption('serper', 'Serper.dev');
        // Note: perplexity is available in type but not shown in UI per user request
        dropdown
          .setValue(this.plugin.settings?.webSearchProvider || DEFAULT_HERMES_SETTINGS.webSearchProvider)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.webSearchProvider = value as 'google' | 'serper' | 'perplexity';
              await saveAppSettings(this.plugin.settings);
              // Refresh settings to update API key field states
              this.display();
            }
          });
      });

          // API Key Section
    new Setting(containerEl)
      .setName('Persistence')
      .setHeading();

    // Chat History Folder
    new Setting(containerEl)
      .setName('Chat history and memory folder')
      .setDesc('Folder path where chat history and memory will be saved')
      .addText((text) => {
        text
          .setPlaceholder('Chat history and memory, default chat-history')
          .setValue(this.plugin.settings?.chatHistoryFolder || DEFAULT_HERMES_SETTINGS.chatHistoryFolder)
          .onChange(async (value) => {
            if (this.plugin.settings) {
              this.plugin.settings.chatHistoryFolder = value;
              await saveAppSettings(this.plugin.settings);
            }
          });
      });



    // Build info at the bottom
    const versionFragment = document.createDocumentFragment();
    versionFragment.createSpan({ text: `Version ${PLUGIN_VERSION}` });
    versionFragment.createEl('br');
    versionFragment.createSpan({ text: `Branch ${GIT_BRANCH}` });
    versionFragment.createEl('br');
    versionFragment.createSpan({ text: `Commit ${GIT_COMMIT}` });

    new Setting(containerEl)
      .setName('Build info')
      .setDesc(versionFragment);
  }
}
