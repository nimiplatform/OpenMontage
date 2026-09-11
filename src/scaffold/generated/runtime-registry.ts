import { composeStudioCapabilityRuntimeHandlers } from '../../capabilities/ai-studio-core/index.js';
import { studioCreateRuntimeHandlers } from '../../capabilities/studio-create/index.js';
import { studioMediaRuntimeHandlers } from '../../capabilities/studio-media/index.js';
import { studioVoiceRuntimeHandlers } from '../../capabilities/studio-voice/index.js';

export const generatedStudioRuntimeHandlers = composeStudioCapabilityRuntimeHandlers([
  studioCreateRuntimeHandlers,
  studioMediaRuntimeHandlers,
  studioVoiceRuntimeHandlers,
]);
