export const DEFAULT_ASSISTANT_NAME = 'Jarvis';

export const resolveAssistantName = (name?: string): string =>
  (name || '').trim() || DEFAULT_ASSISTANT_NAME;

/**
 * Identity block appended to the system prompt at session start.
 *
 * This is injected rather than edited into the stored system instruction on
 * purpose: that instruction is user-owned and may name the assistant something
 * else, so the identity has to override it at runtime instead of depending on
 * its wording. It is placed after the base instruction so it is the later, and
 * therefore stronger, statement about the name.
 */
export const buildIdentityInstruction = (name?: string): string => {
  const assistantName = resolveAssistantName(name);

  return `YOUR NAME:
Your name is ${assistantName}. Answer to it in any language, script or transliteration the user uses — for example the Hebrew "ג'ארוויס" for Jarvis — and to near-misses of it, since speech recognition frequently mangles names.
Never correct the user about your name. Never claim to be called anything else, and never introduce yourself by a different name, even if another name appears elsewhere in these instructions.
If the user addresses you by some other name entirely, just answer normally rather than pointing it out.`;
};
