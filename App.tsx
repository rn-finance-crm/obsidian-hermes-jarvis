import React, { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { LogEntry, TranscriptionEntry, ConnectionStatus, ToolData, UsageMetadata, AppSettings, ImageSearchResult } from './types';
import { Content } from '@google/genai';
import { Notice } from 'obsidian';
import { initFileSystem, listDirectory } from './services/vaultOperations';
import { saveAppSettings, loadAppSettings, saveChatHistory, loadChatHistory, reloadAppSettings } from './persistence/persistence';
import { GeminiVoiceAssistant } from './services/voiceInterface';
import { GeminiTextInterface } from './services/textInterface';
import { DEFAULT_SYSTEM_INSTRUCTION } from './utils/defaultPrompt';
import { isObsidian } from './utils/environment';
import { executeCommand } from './services/commands';
import { resumePendingDeepResearch } from './tools/start_research';
import { persistConversationHistory, PersistenceOptions } from './utils/historyPersistence';
import { getErrorMessage } from './utils/getErrorMessage';
import { getSystemPrompt } from './services/getSystemPrompt';

// Components
import Header from './components/Header';
import Settings from './components/Settings';
import MainWindow from './components/MainWindow';
import InputBar from './components/InputBar';
import ApiKeySetup from './components/ApiKeySetup';
import History from './components/History';

export interface AppHandle {
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  toggleSession: () => Promise<void>;
}

const getErrorStack = (error: unknown): string | undefined => {
  if (error instanceof Error) return error.stack;
  return undefined;
};

const App = forwardRef<AppHandle, Record<string, never>>((_, ref) => {
  const saved = useMemo(() => {
    const data = loadAppSettings();
    return data ?? {};
  }, []);

  useEffect(() => {
    // Check if there's a saved conversation
    const chatHistory = loadChatHistory();
    setHasSavedConversation(!!chatHistory && chatHistory.length > 0);
  }, []);

  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [inputText, setInputText] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showKernel, setShowKernel] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<'user' | 'model' | 'none'>('none');
  const [micVolume, setMicVolume] = useState(0);
  
  const [transcripts, setTranscripts] = useState<TranscriptionEntry[]>([]);
  const transcriptsRef = useRef<TranscriptionEntry[]>([]);
  
  // Keep ref in sync with state
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);
  
  const [hasSavedConversation, setHasSavedConversation] = useState<boolean>(false);
  const [voiceName, setVoiceName] = useState<string>(() => saved.voiceName || 'Zephyr');
  const [customContext, setCustomContext] = useState<string>(() => saved.customContext || '');
  const [systemInstruction, setSystemInstruction] = useState<string>(() => saved.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION);
  const [manualApiKey, setManualApiKey] = useState<string>(() => saved.manualApiKey || '');
  const [serperApiKey, setSerperApiKey] = useState<string>(() => saved.serperApiKey || '');
  const [currentFolder, setCurrentFolder] = useState<string>(() => saved.currentFolder || '/');
  const [currentNote, setCurrentNote] = useState<string | null>(() => saved.currentNote || null);
  const [totalTokens, setTotalTokens] = useState<number>(() => saved.totalTokens || 0);
  const [muted, setMuted] = useState<boolean>(() => saved.muted || false);
  const [usage, setUsage] = useState<UsageMetadata>({ totalTokenCount: saved.totalTokens || 0 });
  const [fileCount, setFileCount] = useState<number>(0);
  const [showApiKeySetup, setShowApiKeySetup] = useState<boolean>(false);
  
  // Topic ID for grouping messages - generated on init and on topic_switch
  const [currentTopicId, setCurrentTopicId] = useState<string>(() => `topic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const currentTopicIdRef = useRef<string>(currentTopicId);
  
  // Keep topicId ref in sync
  useEffect(() => {
    currentTopicIdRef.current = currentTopicId;
  }, [currentTopicId]);

  // Watermarks for context sync between voice and text interfaces
  const [lastVoiceSyncIndex, setLastVoiceSyncIndex] = useState<number>(0);
  const [lastTextSyncIndex, setLastTextSyncIndex] = useState<number>(0);
  
  // Refs for use in callbacks (avoid stale closures)
  const lastVoiceSyncIndexRef = useRef<number>(0);
  const lastTextSyncIndexRef = useRef<number>(0);
  
  // Keep watermark refs in sync
  useEffect(() => {
    lastVoiceSyncIndexRef.current = lastVoiceSyncIndex;
  }, [lastVoiceSyncIndex]);
  
  useEffect(() => {
    lastTextSyncIndexRef.current = lastTextSyncIndex;
  }, [lastTextSyncIndex]);

  const assistantRef = useRef<GeminiVoiceAssistant | null>(null);
  const textInterfaceRef = useRef<GeminiTextInterface | null>(null);

  const isObsidianEnvironment = useMemo(() => {
    return isObsidian();
  }, []);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', duration?: number, errorDetails?: LogEntry['errorDetails']) => {
    setLogs(prev => [...prev, { 
      id: Math.random().toString(36).slice(2, 11), 
      message, 
      timestamp: new Date(), 
      type,
      duration,
      errorDetails
    }]);
  }, []);

  const showToast = useCallback((message: string, duration = 3000) => {
    if (isObsidianEnvironment) {
      new Notice(message, duration);
      return;
    }
    addLog(message, 'info');
  }, [addLog, isObsidianEnvironment]);

  const buildInitialSystemMessage = useCallback(async (): Promise<TranscriptionEntry> => {
    const fullSettings = loadAppSettings() ?? saved;
    console.warn('[App.buildInitialSystemMessage] fullSettings:', {
      hasChatHistoryFolder: !!(fullSettings as AppSettings).chatHistoryFolder,
      chatHistoryFolder: (fullSettings as AppSettings).chatHistoryFolder
    });

    const settings: AppSettings = {
      ...(fullSettings as AppSettings),
      voiceName,
      customContext,
      systemInstruction,
      manualApiKey,
      serperApiKey,
      currentFolder,
      currentNote,
      totalTokens
    };

    console.warn('[App.buildInitialSystemMessage] settings after merge:', {
      chatHistoryFolder: settings.chatHistoryFolder
    });

    const { systemInstruction: fullSystemPrompt, contextSummary } = await getSystemPrompt({
      settings,
      currentFolder,
      currentNote,
      interfaceType: 'text'
    });

    console.warn('[App.buildInitialSystemMessage] getSystemPrompt returned:', {
      promptLength: fullSystemPrompt.length,
      hasMemories: fullSystemPrompt.includes('USER_MEMORIES'),
      contextSummary
    });

    const contextLines = [
      contextSummary,
      '',
      '---',
      '',
      '**Full System Prompt Sent to AI:**',
      '```',
      fullSystemPrompt,
      '```'
    ];

    return {
      id: 'welcome-init',
      role: 'system',
      text: 'HERMES INITIALIZED.',
      isComplete: true,
      timestamp: Date.now(),
      topicId: currentTopicIdRef.current,
      toolData: {
        name: 'system_init',
        filename: '',
        status: 'success',
        dropdown: true,
        newContent: contextLines.join('\n')
      }
    };
  }, [currentFolder, currentNote, customContext, systemInstruction, voiceName, manualApiKey, serperApiKey, totalTokens, saved]);

  // Helper functions for context sync
  const addModeMarker = (mode: 'voice' | 'text') => {
    const marker: TranscriptionEntry = {
      id: `mode-${Date.now()}`,
      role: 'system',
      text: mode === 'voice' 
        ? 'Voice interface activated' 
        : 'Text interface activated',
      isComplete: true,
      timestamp: Date.now(),
      topicId: currentTopicIdRef.current,
      toolData: {
        name: 'mode_switch',
        filename: '',
        status: 'success'
      }
    };
    setTranscripts(prev => [...prev, marker]);
  };

  const computeDelta = (fromIndex: number): TranscriptionEntry[] => {
    return transcriptsRef.current.slice(fromIndex).filter(t =>
      t.role === 'user' || t.role === 'model' || // Include user/model messages
      (t.role === 'system' && t.toolData?.name === 'mode_switch') || // Include mode switches
      (t.role === 'system' && t.toolData?.status === 'success' && t.toolData?.newContent) // Include successful tool results
    );
  };

  const formatDeltaForInjection = (delta: TranscriptionEntry[]): string => {
    if (delta.length === 0) return '';

    const messages = delta.map(t => {
      if (t.role === 'system' && t.toolData) {
        if (t.toolData.name === 'mode_switch') return `[Switched to ${t.text}]`;
        const summary = t.toolData.newContent
          ? t.toolData.newContent.substring(0, 200)
          : t.text;
        return `[Tool ${t.toolData.name}: ${summary}]`;
      }
      const role = t.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${t.text}`;
    });

    return messages.join('\n\n');
  };

  const transcriptsToContents = (transcripts: TranscriptionEntry[]): Content[] => {
    const contents: Content[] = [];
    for (const t of transcripts) {
      if (t.role === 'user' || t.role === 'model') {
        contents.push({
          role: t.role as 'user' | 'model',
          parts: [{ text: t.text }]
        });
      } else if (t.role === 'system' && t.toolData?.status === 'success' && t.toolData?.newContent) {
        // Include successful tool results as model context so text API knows about prior tool use
        contents.push({
          role: 'model',
          parts: [{ text: `[Executed ${t.toolData.name}: ${t.toolData.newContent.substring(0, 500)}]` }]
        });
      }
    }
    return contents;
  };

  const restoreConversation = (conversation?: TranscriptionEntry[]) => {
    if (conversation) {
      // Restore from archived conversation
      setTranscripts(conversation);
      setHasSavedConversation(false);
      addLog('Archived conversation restored', 'info');
      setHistoryOpen(false); // Close history panel after restore
    } else {
      // Restore from chat history (original functionality)
      const chatHistory = loadChatHistory();
      if (chatHistory && chatHistory.length > 0) {
        // Convert chat history to transcript format
        const transcriptHistory: TranscriptionEntry[] = chatHistory.map((message, index) => ({
          id: `chat-${index}`,
          role: 'user' as const,
          text: message,
          isComplete: true,
          timestamp: Date.now() - (chatHistory.length - index) * 1000,
          topicId: currentTopicIdRef.current
        }));
        setTranscripts(transcriptHistory);
        setHasSavedConversation(false);
        addLog('Chat history restored', 'info');
      }
    }
  };

  const resetConversation = async () => {
    const initialMessage = await buildInitialSystemMessage();
    setTranscripts([initialMessage]);
    setHasSavedConversation(false);
    addLog('Conversation reset', 'info');
  };

  useEffect(() => {
    const lastMsg = transcripts[transcripts.length - 1];
    if (lastMsg?.role === 'system' && lastMsg.toolData?.name === 'topic_switch') {
      console.warn('[HISTORY] EVENT: topic_switch detected - Topic switch triggered');
      
      // Get the OLD topicId before we switch (from the topic_switch message itself or current)
      const oldTopicId = lastMsg.topicId || currentTopicIdRef.current;
      
      // Generate NEW topicId for subsequent messages
      const newTopicId = `topic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setCurrentTopicId(newTopicId);
      console.warn(`[HISTORY] Topic switch: ${oldTopicId} -> ${newTopicId}`);
      
      // Filter messages belonging to the OLD topic only
      const transcriptsToArchive = transcripts.filter(t => 
        t.id !== 'welcome-init' && 
        t.id !== lastMsg.id && 
        t.topicId === oldTopicId
      );
      
      // Get current settings to access chatHistoryFolder
      const currentSettings = loadAppSettings();
      const chatHistoryFolder = currentSettings?.chatHistoryFolder || 'chat-history';
      
      // Prepare options for the persistence pipeline
      const options: PersistenceOptions = {
        transcripts: transcriptsToArchive,
        chatHistoryFolder,
        textInterface: textInterfaceRef.current,
        topicId: oldTopicId
      };
      
      // Use the same unified pipeline as end_conversation
      persistConversationHistory(options)
        .then(result => {
          if (result.success) {
            if (result.skipped) {
              addLog(result.message, 'info');
            } else {
              addLog(result.message, 'action');
              // Add system marker for conversation boundary instead of clearing
              setTranscripts(prev => [...prev, {
                id: `archived-${Date.now()}`,
                role: 'system',
                text: `📁 Topic switch - conversation archived: ${result.message}`,
                timestamp: Date.now(),
                isComplete: true,
                topicId: newTopicId  // Use NEW topicId for archive marker
              }]);
            }
          } else {
            const errorDetails = {
              toolName: 'persistConversationHistory',
              content: `History length: ${transcriptsToArchive.length} entries`,
              contentSize: JSON.stringify(transcriptsToArchive).length,
              stack: result.error,
              apiCall: 'archiveConversation'
            };
            addLog(`Persistence Failure: ${result.message}`, 'error', undefined, errorDetails);
          }
        })
        .catch(error => {
          const errorMsg = getErrorMessage(error);
          const errorDetails = {
            toolName: 'persistConversationHistory',
            content: `History length: ${transcriptsToArchive.length} entries`,
            contentSize: JSON.stringify(transcriptsToArchive).length,
            stack: errorMsg,
            apiCall: 'archiveConversation'
          };
          addLog(`Persistence Failure: ${errorMsg}`, 'error', undefined, errorDetails);
        });
    }
  }, [transcripts, addLog]);

  useEffect(() => {
    void (async () => {
      try {
        await initFileSystem();
        const files = listDirectory();
        setFileCount(files.length);
        addLog('HERMES_OS: Modules online.', 'info');
        
        // Check if we have chat history to restore
        const chatHistory = loadChatHistory();
        if (transcripts.length === 0 && (!chatHistory || chatHistory.length === 0)) {
          const initialMessage = await buildInitialSystemMessage();
          setTranscripts([initialMessage]);
        }
      } catch (error) {
        addLog(`Initialization failed: ${getErrorMessage(error)}`, 'error');
      }
    })();
  }, [addLog, buildInitialSystemMessage]);

  useEffect(() => {
    void saveAppSettings({
      voiceName,
      customContext,
      systemInstruction,
      manualApiKey,
      serperApiKey,
      currentFolder,
      currentNote,
      totalTokens,
      muted
    });
  }, [voiceName, customContext, systemInstruction, manualApiKey, serperApiKey, currentFolder, currentNote, totalTokens, muted]);

  // Check API key and show setup screen if needed
  useEffect(() => {
    const activeKey = (manualApiKey || '').trim();
    const shouldShowSetup = !activeKey;
    setShowApiKeySetup(shouldShowSetup);
  }, [manualApiKey]);

  // Hook into settings updates from Obsidian
  useEffect(() => {
    const checkSettingsUpdate = () => {
      void (async () => {
        const reloadedSettings = await reloadAppSettings();
        if (reloadedSettings) {
          // Only update if the reloaded settings are actually different
          // and don't overwrite manual API key changes
          setVoiceName(prev => reloadedSettings.voiceName !== undefined ? reloadedSettings.voiceName || 'Zephyr' : prev);
          setCustomContext(prev => reloadedSettings.customContext !== undefined ? reloadedSettings.customContext : prev);
          setSystemInstruction(prev => reloadedSettings.systemInstruction !== undefined ? reloadedSettings.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION : prev);
          setSerperApiKey(prev => reloadedSettings.serperApiKey !== undefined ? reloadedSettings.serperApiKey : prev);
          if (reloadedSettings.muted !== undefined) setMuted(reloadedSettings.muted);

          // Only update manual API key if current one is empty and reloaded one has value
          if (!manualApiKey.trim() && reloadedSettings.manualApiKey?.trim()) {
            setManualApiKey(reloadedSettings.manualApiKey);
          }

          // Check if API key was added
          const activeKey = (manualApiKey || '').trim();
          if (activeKey && showApiKeySetup) {
            setShowApiKeySetup(false);
            addLog('API key configured successfully', 'success');
          }
        }
      })();
    };

    // Listen for direct settings updates from Obsidian
    const handleSettingsUpdate = (settings: AppSettings) => {
      // Only update if the settings are actually different
      // and don't overwrite manual API key changes
      setVoiceName(prev => settings.voiceName !== undefined ? settings.voiceName || 'Zephyr' : prev);
      setCustomContext(prev => settings.customContext !== undefined ? settings.customContext : prev);
      setSystemInstruction(prev => settings.systemInstruction !== undefined ? settings.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION : prev);
      setSerperApiKey(prev => settings.serperApiKey !== undefined ? settings.serperApiKey : prev);
      if (settings.muted !== undefined) setMuted(settings.muted);

      // Only update manual API key if current one is empty and new one has value
      if (!manualApiKey.trim() && settings.manualApiKey?.trim()) {
        setManualApiKey(settings.manualApiKey);
      }

      // Check if API key was added
      const activeKey = (settings.manualApiKey || '').trim();
      if (activeKey && showApiKeySetup) {
        setShowApiKeySetup(false);
        addLog('API key configured successfully', 'success');
      }
    };

    // Register global handler
    window.hermesSettingsUpdate = handleSettingsUpdate;

    // Check settings updates periodically
    const interval = setInterval(checkSettingsUpdate, 2000);
    
    return () => {
      clearInterval(interval);
      // Clean up global handler
      delete window.hermesSettingsUpdate;
    };
  }, [showApiKeySetup, addLog, manualApiKey]);

  const toggleSession = async () => {
    if (status === ConnectionStatus.CONNECTED) {
        stopSession();
    } else {
        await startSession();
    }
  };

  // Expose methods via ref for command palette access
  useImperativeHandle(ref, () => ({
    startSession,
    stopSession,
    toggleSession
  }));

  // Apply muted state to active voice session
  useEffect(() => {
    if (assistantRef.current) {
      assistantRef.current.setMuted(muted);
    }
  }, [muted]);

  // Cleanup voice session on component unmount
  useEffect(() => {
    return () => {
      if (assistantRef.current) {
        assistantRef.current.stop();
        assistantRef.current = null;
        // Don't archive here as it's component unmount, not intentional conversation end
      }
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible';
      
      // Only log if voice session is active
      if (assistantRef.current) {
        if (!isVisible) {
          // Screen locked or app backgrounded
          setTranscripts(prev => [...prev, {
            id: `visibility-${Date.now()}`,
            role: 'system',
            text: '📱 Screen locked or app backgrounded - connection may drop',
            isComplete: true,
            timestamp: Date.now(),
            topicId: currentTopicIdRef.current
          }]);
        } else {
          // Screen unlocked or app foregrounded
          setTranscripts(prev => [...prev, {
            id: `visibility-${Date.now()}`,
            role: 'system',
            text: '📱 Screen unlocked - checking connection...',
            isComplete: true,
            timestamp: Date.now(),
            topicId: currentTopicIdRef.current
          }]);
        }
        
        assistantRef.current.handleVisibilityChange(isVisible);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const archiveCurrentConversation = useCallback(async () => {
    // Use ref to get latest transcripts (avoids stale closure issue)
    const currentTranscripts = transcriptsRef.current;
    
    console.warn('[HISTORY] EVENT: end_conversation - Session ending (archiveCurrentConversation)');
    
    // Get current settings to access chatHistoryFolder
    const currentSettings = loadAppSettings();
    const chatHistoryFolder = currentSettings?.chatHistoryFolder || 'chat-history';
    
    // Prepare options for the persistence pipeline
    const options: PersistenceOptions = {
      transcripts: currentTranscripts,
      chatHistoryFolder,
      textInterface: textInterfaceRef.current
    };
    
    try {
      const result = await persistConversationHistory(options);
      
      if (result.success) {
        if (result.skipped) {
          addLog(result.message, 'info');
        } else {
          addLog(result.message, 'action');
          // Add system marker for conversation boundary instead of clearing
          setTranscripts(prev => [...prev, {
            id: `archived-${Date.now()}`,
            role: 'system',
            text: `📁 Conversation archived: ${result.message}`,
            timestamp: Date.now(),
            isComplete: true,
            topicId: currentTopicIdRef.current
          }]);
        }
      } else {
        const errorDetails = {
          toolName: 'persistConversationHistory',
          content: `History length: ${currentTranscripts.length} entries`,
          contentSize: JSON.stringify(currentTranscripts).length,
          stack: result.error,
          apiCall: 'archiveConversation'
        };
        addLog(`Persistence Failure: ${result.message}`, 'error', undefined, errorDetails);
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      const errorDetails = {
        toolName: 'persistConversationHistory',
        content: `History length: ${currentTranscripts.length} entries`,
        contentSize: JSON.stringify(currentTranscripts).length,
        stack: errorMsg,
        apiCall: 'archiveConversation'
      };
      addLog(`Persistence Failure: ${errorMsg}`, 'error', undefined, errorDetails);
    }
  }, [addLog]);

  // Note: Archive is now handled in voiceInterface.stop() to avoid race conditions
  // The previous useEffect that watched for DISCONNECTED status was causing duplicate saves

  // Add a counter for unique system message IDs
  const systemMessageCounterRef = useRef(0);
  const announcedResearchRef = useRef<Set<string>>(new Set());
  const resumedResearchOnBootRef = useRef(false);

  const handleSystemMessage = useCallback((text: string, toolData?: ToolData) => {
    if (toolData?.name === 'start_research' && toolData?.status === 'success' && toolData?.id) {
      const alreadyAnnounced = announcedResearchRef.current.has(toolData.id);
      if (!alreadyAnnounced && assistantRef.current && status === ConnectionStatus.CONNECTED) {
        announcedResearchRef.current.add(toolData.id);
        const savedLine = toolData.newContent
          ?.split('\n')
          .find(line => line.startsWith('Saved:'))
          ?.replace('Saved:', '')
          .trim();
        const targetPath = savedLine || toolData.targetPath || toolData.description || 'research note';
        const conclusionFromContent = toolData.newContent
          ?.split('\n')
          .find(line => line.startsWith('Conclusion:'))
          ?.replace('Conclusion:', '')
          .trim() || 'Research completed.';
        assistantRef.current.notifyResearchComplete(targetPath, conclusionFromContent);
      }
    }

    setTranscripts(prev => {
      // Check if this is an update to an existing tool execution
      if (toolData?.id) {
        const existingIdx = prev.findIndex(t => t.toolData?.id === toolData.id);
        if (existingIdx !== -1) {
          const next = [...prev];
          next[existingIdx] = {
            ...next[existingIdx],
            text,
            toolData: { ...next[existingIdx].toolData, ...toolData, status: toolData.status || 'success' }
          };
          return next;
        }
      }
      // Generate unique ID using counter + timestamp
      const uniqueId = `sys-${Date.now()}-${++systemMessageCounterRef.current}`;
      return [...prev, { id: uniqueId, role: 'system', text, isComplete: true, toolData, timestamp: Date.now(), topicId: currentTopicIdRef.current }];
    });
    setFileCount(listDirectory().length);
  }, [status]);

  useEffect(() => {
    const activeKey = manualApiKey.trim();
    if (!activeKey) return;
    if (resumedResearchOnBootRef.current) return;

    resumedResearchOnBootRef.current = true;
    void resumePendingDeepResearch({
      onLog: (message, type, duration, errorDetails) => addLog(message, type, duration, errorDetails),
      onSystem: (text, toolData) => handleSystemMessage(text, toolData),
      onFileState: () => {
        // No folder/note state changes expected from resume polling.
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[deep_research_resume] failed', { message, stack: getErrorStack(error) });
      addLog(`Failed to resume pending research tasks: ${message}`, 'error');
    });
  }, [manualApiKey, addLog, handleSystemMessage]);

  const handleImageDownload = useCallback(async (image: ImageSearchResult, index: number) => {
    try {
      const result = await executeCommand('download_image', {
        imageUrl: image.url,
        title: image.title,
        query: image.query || image.originalQuery || 'image',
        index: index + 1
      }, {
        onLog: () => {},
        onSystem: handleSystemMessage,
        onFileState: () => {}
      });
      
      return result;
    } catch (error) {
      console.error('Failed to download image:', error);
      throw error;
    }
  }, [handleSystemMessage]);

  const assistantCallbacks = useMemo(() => ({
    onStatusChange: (s: ConnectionStatus) => {
      setStatus(s);
      if (s === ConnectionStatus.CONNECTED) {
        addLog('UPLINK ESTABLISHED.', 'info');
      } else if (s === ConnectionStatus.DISCONNECTED) {
        setActiveSpeaker('none');
        setMicVolume(0);
      }
    },
    onLog: (m: string, t: LogEntry['type'], d?: number, e?: LogEntry['errorDetails']) => addLog(m, t, d, e),
    onTranscription: (role: 'user' | 'model', text: string, isComplete: boolean) => {
      setActiveSpeaker(isComplete ? 'none' : role);
      setTranscripts(prev => {
        const activeIdx = prev.reduceRight((acc, e, i) => (acc !== -1 ? acc : (e.role === role && !e.isComplete ? i : -1)), -1);
        if (activeIdx !== -1) {
          const updated = [...prev];
          updated[activeIdx] = { ...updated[activeIdx], text: text || updated[activeIdx].text, isComplete };
          return updated;
        }
        const newEntry = { id: Math.random().toString(36).slice(2, 11), role, text, isComplete, timestamp: Date.now(), topicId: currentTopicIdRef.current };
        return [...prev, newEntry];
      });
    },
    onSystemMessage: handleSystemMessage,
    onToast: (message: string, duration?: number) => showToast(message, duration),
    onInterrupted: () => { setActiveSpeaker('none'); setMicVolume(0); },
    onFileStateChange: (folder: string, note: string | string[] | null) => { 
      setCurrentFolder(folder);
      const notes = Array.isArray(note) ? note : (note ? [note] : []);
      if (notes.length > 0) {
        setCurrentNote(notes[notes.length - 1]);
      }
    },
    onUsageUpdate: (usage: UsageMetadata) => { 
      setUsage(usage);
      const tokens = usage.totalTokenCount;
      if (tokens !== undefined) setTotalTokens(tokens); 
    },
    onVolume: (volume: number) => setMicVolume(volume),
    onArchiveConversation: archiveCurrentConversation
  }), [addLog, showToast, handleSystemMessage, archiveCurrentConversation]);

  // Initialize text interface when API key is available (for text mode)
  useEffect(() => {
    const initializeTextInterface = async () => {
      const activeKey = manualApiKey.trim();
      if (activeKey && !textInterfaceRef.current) {
        textInterfaceRef.current = new GeminiTextInterface({
          onLog: (m, t, d, e) => addLog(m, t, d, e),
          onTranscription: (role, text, isComplete) => {
            setTranscripts(prev => {
              const activeIdx = prev.reduceRight((acc, e, i) => (acc !== -1 ? acc : (e.role === role && !e.isComplete ? i : -1)), -1);
              if (activeIdx !== -1) {
                const updated = [...prev];
                updated[activeIdx] = { ...updated[activeIdx], text: text || updated[activeIdx].text, isComplete };
                
                // Save completed user messages to chat history
                if (role === 'user' && isComplete && text.trim()) {
                  const currentHistory = loadChatHistory();
                  const updatedHistory = [...currentHistory, text];
                  void saveChatHistory(updatedHistory);
                }
                
                return updated;
              }
              const newEntry = { id: Math.random().toString(36).slice(2, 11), role, text, isComplete, timestamp: Date.now(), topicId: currentTopicIdRef.current };
              
              // Save completed user messages to chat history
              if (role === 'user' && isComplete && text.trim()) {
                const currentHistory = loadChatHistory();
                const updatedHistory = [...currentHistory, text];
                void saveChatHistory(updatedHistory);
              }
              
              return [...prev, newEntry];
            });
          },
          onSystemMessage: handleSystemMessage,
          onFileStateChange: (folder, note) => {
            setCurrentFolder(folder);
            const notes = Array.isArray(note) ? note : (note ? [note] : []);
            if (notes.length > 0) {
              setCurrentNote(notes[notes.length - 1]);
            }
          },
          onUsageUpdate: (usage: UsageMetadata) => { 
            setUsage(usage);
            const tokens = usage.totalTokenCount;
            if (tokens !== undefined) setTotalTokens(tokens); 
          },
          onArchiveConversation: archiveCurrentConversation
        });
        
        await textInterfaceRef.current.initialize(activeKey, { voiceName, customContext, systemInstruction }, { folder: currentFolder, note: currentNote });
      }
    };
    
    initializeTextInterface().catch((error) => {
      addLog(`Failed to initialize text interface: ${error instanceof Error ? error.message : String(error)}`, 'error');
    });
  }, [manualApiKey, voiceName, customContext, systemInstruction, currentFolder, currentNote, addLog, handleSystemMessage, archiveCurrentConversation]);

  const startSession = async () => {
    try {
      console.warn('[HISTORY] EVENT: start_conversation - Session started');
      
      const activeKey = manualApiKey.trim();
      if (!activeKey) {
        setShowApiKeySetup(true);
        return;
      }
      if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
        await window.aistudio.openSelectKey();
      }
      
      // Add mode marker
      addModeMarker('voice');
      
      // Compute delta since last voice sync for context injection via system prompt
      const delta = computeDelta(lastVoiceSyncIndexRef.current);
      const conversationHistory = delta.length > 0 ? formatDeltaForInjection(delta) : undefined;
      
      if (conversationHistory) {
        addLog(`[CONTEXT SYNC] Including ${delta.length} messages in voice session system prompt (${conversationHistory.length} chars)`, 'info');
      }
      
      // Create and start voice session with conversation history in system prompt
      // Get chatHistoryFolder from persisted settings
      const fullSettings = loadAppSettings();
      const chatHistoryFolder = fullSettings?.chatHistoryFolder;
      
      assistantRef.current = new GeminiVoiceAssistant(assistantCallbacks);
      await assistantRef.current.start(
        activeKey,
        { voiceName, customContext, systemInstruction, chatHistoryFolder, muted },
        { folder: currentFolder, note: currentNote },
        conversationHistory
      );
      
      // Update watermark
      setLastVoiceSyncIndex(transcriptsRef.current.length);
      lastVoiceSyncIndexRef.current = transcriptsRef.current.length;
    } catch (err) {
      const errorDetails = {
        toolName: 'GeminiVoiceAssistant',
        content: `Voice Name: ${voiceName}\nCustom Context: ${customContext}\nSystem Instruction: ${systemInstruction}`,
        contentSize: voiceName.length + customContext.length + systemInstruction.length,
        stack: getErrorStack(err),
        apiCall: 'startSession'
      };
      addLog(`Uplink Error: ${getErrorMessage(err)}`, 'error', undefined, errorDetails);
      setStatus(ConnectionStatus.ERROR);
    }
  };

  const stopSession = () => {
    if (assistantRef.current) {
      // Archive is now handled inside voiceInterface.stop()
      assistantRef.current.stop();
      assistantRef.current = null;
      setActiveSpeaker('none');
      setMicVolume(0);
    }
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault(); 
    if (!inputText.trim()) return;
    
    const message = inputText.trim();
    setInputText('');
    
    // Text input is disabled while voice is active (handled in InputBar)
    // If somehow we get here while voice is active, just ignore
    if (status === ConnectionStatus.CONNECTED && assistantRef.current) {
      addLog('[CONTEXT SYNC] Text input ignored - voice session active', 'info');
      return;
    }
    
    // Voice was not active - add mode marker and sync to text interface
    addModeMarker('text');
    
    // Use text interface
    const activeKey = manualApiKey.trim();
    if (!activeKey) {
      setShowApiKeySetup(true);
      return;
    }
    
    // Initialize text interface if not already done
    if (!textInterfaceRef.current) {
      textInterfaceRef.current = new GeminiTextInterface({
        onLog: (m, t, d, e) => addLog(m, t, d, e),
        onTranscription: (role, text, isComplete) => {
          setTranscripts(prev => {
            const activeIdx = prev.reduceRight((acc, e, i) => (acc !== -1 ? acc : (e.role === role && !e.isComplete ? i : -1)), -1);
            if (activeIdx !== -1) {
              const updated = [...prev];
              updated[activeIdx] = { ...updated[activeIdx], text: text || updated[activeIdx].text, isComplete };
              return updated;
            }
            return [...prev, { id: Math.random().toString(36).slice(2, 11), role, text, isComplete, timestamp: Date.now(), topicId: currentTopicIdRef.current }];
          });
        },
        onSystemMessage: handleSystemMessage,
        onFileStateChange: (folder, note) => {
          setCurrentFolder(folder);
          const notes = Array.isArray(note) ? note : (note ? [note] : []);
          if (notes.length > 0) {
            setCurrentNote(notes[notes.length - 1]);
          }
        },
        onUsageUpdate: (usage: UsageMetadata) => {
          setUsage(usage);
          if (usage.totalTokenCount !== undefined) setTotalTokens(usage.totalTokenCount);
        },
        onArchiveConversation: archiveCurrentConversation
      });
      
      await textInterfaceRef.current.initialize(activeKey, { voiceName, customContext, systemInstruction }, { folder: currentFolder, note: currentNote });
    }
    
    // Sync delta to text interface
    const delta = computeDelta(lastTextSyncIndexRef.current);
    if (delta.length > 0 && textInterfaceRef.current) {
      const contents = transcriptsToContents(delta);
      addLog(`[CONTEXT SYNC] Injecting ${delta.length} messages to text interface`, 'info');
      
      try {
        textInterfaceRef.current.injectHistory(contents);
        addLog('[CONTEXT SYNC] Successfully injected context to text interface', 'info');
      } catch (injectErr) {
        addLog(`[CONTEXT SYNC] Failed to inject context to text: ${getErrorMessage(injectErr)}`, 'error');
        console.error('[CONTEXT SYNC] Text injection failed:', injectErr, 'Contents were:', contents);
      }
    }
    
    // Update watermark
    setLastTextSyncIndex(transcriptsRef.current.length);
    lastTextSyncIndexRef.current = transcriptsRef.current.length;
    
    // Send message
    textInterfaceRef.current.sendMessage(message);
  };

  return (
    <div className={`hermes-root flex flex-col overflow-hidden ${isObsidianEnvironment ? '' : 'standalone'}`}>
      {showApiKeySetup ? (
        <ApiKeySetup />
      ) : (
        <>
          <Settings
            isOpen={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            voiceName={voiceName}
            setVoiceName={setVoiceName}
            customContext={customContext}
            setCustomContext={setCustomContext}
            systemInstruction={systemInstruction}
            setSystemInstruction={setSystemInstruction}
            manualApiKey={manualApiKey}
            setManualApiKey={setManualApiKey}
            serperApiKey={serperApiKey}
            setSerperApiKey={setSerperApiKey}
            muted={muted}
            setMuted={setMuted}
            onUpdateApiKey={() => (window as { aistudio?: { openSelectKey?: () => void } }).aistudio?.openSelectKey()}
          />
          
          <Header 
            status={status}
            showLogs={showKernel}
            onToggleLogs={() => setShowKernel(!showKernel)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHistory={() => setHistoryOpen(!historyOpen)}
            isListening={status === ConnectionStatus.CONNECTED}
            onStopSession={stopSession}
            onResetConversation={resetConversation}
            transcripts={transcripts}
          />
          
          {historyOpen ? (
            <History isActive={true} onRestoreConversation={restoreConversation} />
          ) : (
            <MainWindow 
              showKernel={showKernel}
              transcripts={transcripts} 
              hasSavedConversation={hasSavedConversation}
              onRestoreConversation={restoreConversation}
              logs={logs}
              usage={usage}
              onFlushLogs={() => setLogs([])}
              fileCount={fileCount}
              onImageDownload={handleImageDownload}
            />
          )}
          
          <InputBar 
            inputText={inputText} 
            setInputText={setInputText} 
            onSendText={handleSendText} 
            isListening={status === ConnectionStatus.CONNECTED} 
            onStartSession={startSession} 
            onStopSession={stopSession} 
            status={status} 
            activeSpeaker={activeSpeaker} 
            volume={micVolume}
            hasApiKey={!showApiKeySetup}
          />
        </>
      )}
    </div>
  );
});

App.displayName = 'App';

export default App;
