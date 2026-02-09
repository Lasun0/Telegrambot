/**
 * User Settings Storage
 * Simple JSON file-based storage for user preferences
 */

import * as fs from 'fs'
import * as path from 'path'

export interface UserSettings {
  userId: number
  username?: string
  apiProvider: 'gemini' | 'knight'
  model: string
  createdAt: Date
  updatedAt: Date
}

// Default settings
const DEFAULT_SETTINGS: Omit<UserSettings, 'userId' | 'createdAt' | 'updatedAt'> = {
  apiProvider: (process.env.DEFAULT_API_PROVIDER as 'gemini' | 'knight') || 'gemini',
  model: process.env.DEFAULT_MODEL || 'gemini-2.0-flash'
}

// Settings file path
const SETTINGS_DIR = path.join(process.cwd(), 'data')
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'user-settings.json')

// In-memory cache
let settingsCache: Map<number, UserSettings> | null = null

/**
 * Ensure settings directory exists
 */
function ensureSettingsDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true })
  }
}

/**
 * Load settings from file
 */
function loadSettings(): Map<number, UserSettings> {
  if (settingsCache) {
    return settingsCache
  }

  ensureSettingsDir()

  if (!fs.existsSync(SETTINGS_FILE)) {
    settingsCache = new Map()
    return settingsCache
  }

  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(data) as Record<string, UserSettings>

    settingsCache = new Map(
      Object.entries(parsed).map(([key, value]) => [parseInt(key), {
        ...value,
        createdAt: new Date(value.createdAt),
        updatedAt: new Date(value.updatedAt)
      }])
    )

    return settingsCache
  } catch (error) {
    console.error('[UserSettings] Failed to load settings:', error)
    settingsCache = new Map()
    return settingsCache
  }
}

/**
 * Save settings to file
 */
function saveSettings(): void {
  ensureSettingsDir()

  const settings = loadSettings()
  const data: Record<string, UserSettings> = {}

  settings.forEach((value, key) => {
    data[key.toString()] = value
  })

  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2))
  } catch (error) {
    console.error('[UserSettings] Failed to save settings:', error)
  }
}

/**
 * Get user settings
 */
export function getUserSettings(userId: number): UserSettings {
  const settings = loadSettings()
  const existing = settings.get(userId)

  if (existing) {
    return existing
  }

  // Create default settings for new user
  const newSettings: UserSettings = {
    userId,
    ...DEFAULT_SETTINGS,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  settings.set(userId, newSettings)
  saveSettings()

  return newSettings
}

/**
 * Update user settings
 */
export function updateUserSettings(
  userId: number,
  updates: Partial<Pick<UserSettings, 'apiProvider' | 'model' | 'username'>>
): UserSettings {
  const settings = loadSettings()
  const existing = getUserSettings(userId)

  const updated: UserSettings = {
    ...existing,
    ...updates,
    updatedAt: new Date()
  }

  settings.set(userId, updated)
  saveSettings()

  return updated
}

/**
 * Get all users
 */
export function getAllUsers(): UserSettings[] {
  const settings = loadSettings()
  return Array.from(settings.values())
}

/**
 * Delete user settings
 */
export function deleteUserSettings(userId: number): boolean {
  const settings = loadSettings()
  const deleted = settings.delete(userId)

  if (deleted) {
    saveSettings()
  }

  return deleted
}

/**
 * Available models for selection
 */
export const AVAILABLE_MODELS = {
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast and efficient' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Balanced speed/quality' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Best quality, slower' }
  ],
  knight: [
    { id: 'knight:gpt-4-vision', name: 'GPT-4 Vision', description: 'OpenAI vision model' }
  ]
}

/**
 * Get model display name
 */
export function getModelDisplayName(modelId: string): string {
  for (const provider of Object.values(AVAILABLE_MODELS)) {
    const model = provider.find(m => m.id === modelId)
    if (model) {
      return model.name
    }
  }
  return modelId
}

/**
 * Check if model ID is valid
 */
export function isValidModel(modelId: string): boolean {
  for (const provider of Object.values(AVAILABLE_MODELS)) {
    if (provider.some(m => m.id === modelId)) {
      return true
    }
  }
  return false
}
