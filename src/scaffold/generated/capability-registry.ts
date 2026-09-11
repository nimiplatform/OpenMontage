import {
  aiStudioCoreMessageBundles,
  composeAIStudioModules,
  mergeAIStudioMessageBundles,
} from '../../capabilities/ai-studio-core/index.js';
import { studioCreateModule, studioCreateMessageBundles } from '../../capabilities/studio-create/index.js';
import { studioMediaModule, studioMediaMessageBundles } from '../../capabilities/studio-media/index.js';
import { studioVoiceModule, studioVoiceMessageBundles } from '../../capabilities/studio-voice/index.js';

export const generatedAIStudioModules = Object.freeze([studioCreateModule, studioMediaModule, studioVoiceModule]);
export const generatedAIStudioComposition = composeAIStudioModules(generatedAIStudioModules);
export const generatedAIStudioRegistrations = generatedAIStudioComposition.capabilities;
export const generatedAIStudioMessageBundles = Object.freeze({
  en: mergeAIStudioMessageBundles([aiStudioCoreMessageBundles.en, studioCreateMessageBundles.en, studioMediaMessageBundles.en, studioVoiceMessageBundles.en]),
  zh: mergeAIStudioMessageBundles([aiStudioCoreMessageBundles.zh, studioCreateMessageBundles.zh, studioMediaMessageBundles.zh, studioVoiceMessageBundles.zh]),
});
