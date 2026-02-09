export interface VideoAnalysisResult {
  clean_script: string
  chapters: Array<{
    title: string
    start_time: string
    end_time: string
    summary: string
    key_points: string[]
  }>
  full_session_summary: string
  important_concepts: string[]
  recommended_practice: string[]
  content_metadata: {
    original_duration_estimate: string
    essential_content_duration: string
    content_removed_percentage: number
    filtered_categories: Array<{
      category: string
      description: string
      approximate_duration: string
    }>
    main_content_timestamps: Array<{
      start: string
      end: string
      description: string
    }>
  }
}

export interface ProcessingStatus {
  stage: 'uploading' | 'processing' | 'analyzing' | 'complete' | 'error'
  progress: number
  message: string
  estimatedTime?: string
}

export function formatTimestamp(time: string): string {
  return time
}

export function formatDuration(duration: string): string {
  // Handle various duration formats
  if (!duration) return 'Unknown'
  return duration
}

export function downloadAsJson(data: VideoAnalysisResult, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadAsText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function formatChaptersAsText(chapters: VideoAnalysisResult['chapters']): string {
  return chapters
    .map((chapter, index) => {
      return `Chapter ${index + 1}: ${chapter.title}
Time: ${chapter.start_time} - ${chapter.end_time}
Summary: ${chapter.summary}
Key Points:
${chapter.key_points.map(point => `  - ${point}`).join('\n')}
`
    })
    .join('\n---\n\n')
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function getFilteredContentSummary(metadata: VideoAnalysisResult['content_metadata']): string {
  if (!metadata || !metadata.filtered_categories || metadata.filtered_categories.length === 0) {
    return 'No content was filtered from this recording.'
  }

  const categories = metadata.filtered_categories
    .map(cat => `${cat.category} (${cat.approximate_duration})`)
    .join(', ')

  return `Removed ${metadata.content_removed_percentage}% of content: ${categories}`
}

// Validate and normalize API response
export function validateAnalysisResult(data: unknown): VideoAnalysisResult | null {
  if (!data || typeof data !== 'object') {
    console.error('Invalid data type:', typeof data)
    return null
  }

  const result = data as Partial<VideoAnalysisResult>

  // Log what we received for debugging
  console.log('Validating API response. Keys present:', Object.keys(result))

  // Check required fields
  if (!result.clean_script || typeof result.clean_script !== 'string') {
    console.error('Missing or invalid clean_script. Type:', typeof result.clean_script)
    return null
  }

  // Normalize chapters
  const chapters = Array.isArray(result.chapters) ? result.chapters : []

  if (!Array.isArray(result.chapters)) {
    console.warn('chapters field is missing or not an array. Type:', typeof result.chapters)
  }

  // Normalize other fields with fallbacks
  return {
    clean_script: result.clean_script,
    chapters: chapters,
    full_session_summary: result.full_session_summary || 'No summary available.',
    important_concepts: Array.isArray(result.important_concepts) ? result.important_concepts : [],
    recommended_practice: Array.isArray(result.recommended_practice) ? result.recommended_practice : [],
    content_metadata: result.content_metadata || {
      original_duration_estimate: 'Unknown',
      essential_content_duration: 'Unknown',
      content_removed_percentage: 0,
      filtered_categories: [],
      main_content_timestamps: [],
    },
  }
}
