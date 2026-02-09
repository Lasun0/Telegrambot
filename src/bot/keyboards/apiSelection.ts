import { Markup } from 'telegraf';
import { AVAILABLE_MODELS, UserSettings } from '../../lib/userSettings';

/**
 * Create API provider selection keyboard
 */
export function getProviderKeyboard(currentProvider: string) {
  const buttons = [
    [
      Markup.button.callback(
        `${currentProvider === 'gemini' ? '✅ ' : ''}Google Gemini`,
        'select_provider:gemini'
      ),
      Markup.button.callback(
        `${currentProvider === 'knight' ? '✅ ' : ''}Knight (OpenAI)`,
        'select_provider:knight'
      )
    ],
    [Markup.button.callback('🔙 Back to Settings', 'settings_menu')]
  ];

  return Markup.inlineKeyboard(buttons);
}

/**
 * Create Model selection keyboard based on provider
 */
export function getModelKeyboard(provider: 'gemini' | 'knight', currentModel: string) {
  const models = AVAILABLE_MODELS[provider] || [];

  const buttons = models.map(model => [
    Markup.button.callback(
      `${currentModel === model.id ? '✅ ' : ''}${model.name}`,
      `select_model:${model.id}`
    )
  ]);

  buttons.push([Markup.button.callback('🔙 Back to Providers', 'settings_provider')]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Main settings menu keyboard
 */
export function getSettingsKeyboard(settings: UserSettings) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🤖 Change AI Provider', 'settings_provider'),
      Markup.button.callback('🧠 Change Model', 'settings_model')
    ],
    [
      Markup.button.callback('❌ Close Settings', 'close_settings')
    ]
  ]);
}
