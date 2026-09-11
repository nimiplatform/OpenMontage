import i18next from 'i18next';
import { generatedAIStudioMessageBundles } from './capability-registry.js';

export const generatedLocale = globalThis.navigator?.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
const generatedI18n = i18next.createInstance();
void generatedI18n.init({
  lng: generatedLocale,
  fallbackLng: 'en',
  initImmediate: false,
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: generatedAIStudioMessageBundles.en },
    zh: { translation: generatedAIStudioMessageBundles.zh },
  },
});

export function translateGeneratedMessage(
  key: string,
  values?: Readonly<Record<string, unknown>>,
): string {
  return String(generatedI18n.t(key, values ? { ...values } : undefined));
}
