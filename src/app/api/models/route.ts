import { NextResponse } from 'next/server'

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const KNIGHT_API_KEY = process.env.KNIGHT_API_KEY

// API URLs
const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const KNIGHT_MODELS_URL = 'https://knight-omega.duckdns.org/v1/models'

export interface GeminiModel {
  name: string
  displayName: string
  description: string
  inputTokenLimit: number
  outputTokenLimit: number
  supportedGenerationMethods: string[]
}

export interface KnightModel {
  id: string
  object: string
  created: number
  owned_by: string
}

async function fetchGeminiModels(): Promise<Array<{
  id: string
  name: string
  description: string
  inputTokenLimit: number
  outputTokenLimit: number
  provider: 'gemini'
}>> {
  if (!GEMINI_API_KEY) {
    console.log('GEMINI_API_KEY not configured, using default Gemini models')
    // Return default Gemini models if no key provided (fallback)
    return [
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Fast and efficient model optimized for speed',
        inputTokenLimit: 1048576,
        outputTokenLimit: 8192,
        provider: 'gemini' as const,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Most capable model for complex tasks',
        inputTokenLimit: 2097152,
        outputTokenLimit: 8192,
        provider: 'gemini' as const,
      },
      {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash (Experimental)',
        description: 'Latest experimental model with enhanced capabilities',
        inputTokenLimit: 1048576,
        outputTokenLimit: 8192,
        provider: 'gemini' as const,
      }
    ]
  }

  try {
    const response = await fetch(`${GEMINI_MODELS_URL}?key=${GEMINI_API_KEY}`)

    if (!response.ok) {
      console.error('Failed to fetch Gemini models:', await response.text())
      // Fallback to defaults on error
      return [
        {
          id: 'gemini-1.5-flash',
          name: 'Gemini 1.5 Flash',
          description: 'Fast and efficient model optimized for speed',
          inputTokenLimit: 1048576,
          outputTokenLimit: 8192,
          provider: 'gemini' as const,
        },
        {
          id: 'gemini-1.5-pro',
          name: 'Gemini 1.5 Pro',
          description: 'Most capable model for complex tasks',
          inputTokenLimit: 2097152,
          outputTokenLimit: 8192,
          provider: 'gemini' as const,
        }
      ]
    }

    const data = await response.json()

    // Filter and map the models
    const models = (data.models || [])
      .filter((m: GeminiModel) =>
        m.supportedGenerationMethods.includes('generateContent') &&
        (m.name.includes('gemini') || m.displayName.toLowerCase().includes('gemini'))
      )
      .map((model: GeminiModel) => {
        // model.name is like "models/gemini-1.5-flash"
        const id = model.name.replace('models/', '')
        return {
          id: id,
          name: model.displayName || id,
          description: model.description || 'Google Gemini Model',
          inputTokenLimit: model.inputTokenLimit || 32768,
          outputTokenLimit: model.outputTokenLimit || 4096,
          provider: 'gemini' as const,
        }
      })
      .sort((a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name)) // Prefer newer/higher version numbers

    console.log(`Found ${models.length} Gemini models`)
    return models
  } catch (error) {
    console.error('Error fetching Gemini models:', error)
    return []
  }
}

async function fetchKnightModels(): Promise<Array<{
  id: string
  name: string
  description: string
  inputTokenLimit: number
  outputTokenLimit: number
  provider: 'knight'
}>> {
  if (!KNIGHT_API_KEY) {
    console.log('Knight API key not configured, skipping Knight models')
    return []
  }

  try {
    const response = await fetch(KNIGHT_MODELS_URL, {
      headers: {
        'Authorization': `Bearer ${KNIGHT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error('Failed to fetch Knight models:', await response.text())
      return []
    }

    const data = await response.json()

    // Knight API uses OpenAI-compatible format
    const models = (data.data || data.models || [])
      .map((model: KnightModel | string) => {
        const modelId = typeof model === 'string' ? model : model.id
        return {
          id: `knight:${modelId}`,
          name: modelId,
          description: 'Knight API Model',
          inputTokenLimit: 128000, // Default estimate
          outputTokenLimit: 4096,
          provider: 'knight' as const,
        }
      })
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))

    console.log(`Found ${models.length} Knight models`)
    return models
  } catch (error) {
    console.error('Error fetching Knight models:', error)
    return []
  }
}

export async function GET() {
  try {
    console.log('Fetching models from all providers...')

    // Fetch from both providers in parallel
    const [geminiModels, knightModels] = await Promise.all([
      fetchGeminiModels(),
      fetchKnightModels(),
    ])

    // Combine all models
    const allModels = [
      ...geminiModels,
      ...knightModels,
    ]

    if (allModels.length === 0) {
      console.warn('No models found from any provider')
    }

    return NextResponse.json({
      models: allModels,
      gemini: geminiModels,
      knight: knightModels,
      defaultModel: geminiModels.length > 0 ? geminiModels[0].id : (knightModels[0]?.id || 'gemini-1.5-flash'),
    })
  } catch (error) {
    console.error('Error fetching models:', error)
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    )
  }
}