import { Context } from 'telegraf';
import { updateUserSettings, getUserSettings, getModelDisplayName, isValidModel } from '../../lib/userSettings';
import { getProviderKeyboard, getModelKeyboard, getSettingsKeyboard } from '../keyboards/apiSelection';

/**
 * Handle callback queries from inline keyboards
 */
export async function handleCallback(ctx: Context) {
  // @ts-ignore
  const callbackData = ctx.callbackQuery.data;
  const user = ctx.from;

  if (!user || !callbackData) return;

  const settings = getUserSettings(user.id);

  // Handle main settings menu
  if (callbackData === 'settings_menu') {
    await ctx.editMessageText(
      `⚙️ *Settings*\n\n` +
      `*Current Provider:* ${settings.apiProvider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}\n` +
      `*Current Model:* ${getModelDisplayName(settings.model)}\n\n` +
      `Tap the buttons below to change your preferences:`,
      {
        parse_mode: 'Markdown',
        ...getSettingsKeyboard(settings)
      }
    );
    return;
  }

  // Handle provider selection menu
  if (callbackData === 'settings_provider') {
    await ctx.editMessageText(
      `🤖 *Select AI Provider*\n\n` +
      `Choose which AI service to use for processing your videos:`,
      {
        parse_mode: 'Markdown',
        ...getProviderKeyboard(settings.apiProvider)
      }
    );
    return;
  }

  // Handle model selection menu
  if (callbackData === 'settings_model') {
    await ctx.editMessageText(
      `🧠 *Select Model*\n\n` +
      `Choose the specific model for ${settings.apiProvider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}:`,
      {
        parse_mode: 'Markdown',
        ...getModelKeyboard(settings.apiProvider, settings.model)
      }
    );
    return;
  }

  // Handle provider change
  if (callbackData.startsWith('select_provider:')) {
    const provider = callbackData.split(':')[1] as 'gemini' | 'knight';

    // Set default model for the new provider
    const newModel = provider === 'gemini' ? 'gemini-2.0-flash' : 'knight:gpt-4-vision';

    updateUserSettings(user.id, {
      apiProvider: provider,
      model: newModel
    });

    await ctx.answerCbQuery(`Provider changed to ${provider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}`);

    // Go back to model selection for the new provider
    await ctx.editMessageText(
      `🧠 *Select Model*\n\n` +
      `Provider changed! Now choose a model for ${provider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}:`,
      {
        parse_mode: 'Markdown',
        ...getModelKeyboard(provider, newModel)
      }
    );
    return;
  }

  // Handle model change
  if (callbackData.startsWith('select_model:')) {
    const modelId = callbackData.split(':')[1];

    if (isValidModel(modelId)) {
      updateUserSettings(user.id, { model: modelId });

      await ctx.answerCbQuery(`Model changed to ${getModelDisplayName(modelId)}`);

      // Go back to main settings
      const newSettings = getUserSettings(user.id);
      await ctx.editMessageText(
        `⚙️ *Settings*\n\n` +
        `*Current Provider:* ${newSettings.apiProvider === 'gemini' ? 'Google Gemini' : 'Knight (OpenAI)'}\n` +
        `*Current Model:* ${getModelDisplayName(newSettings.model)}\n\n` +
        `Tap the buttons below to change your preferences:`,
        {
          parse_mode: 'Markdown',
          ...getSettingsKeyboard(newSettings)
        }
      );
    } else {
      await ctx.answerCbQuery('Invalid model selected');
    }
    return;
  }

  // Handle close
  if (callbackData === 'close_settings') {
    await ctx.deleteMessage();
    return;
  }
}
