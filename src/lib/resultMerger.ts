/**
 * Result Merger Utility
 * Combines multiple VideoAnalysisResult objects from chunked processing
 */

import { adjustTimestamp, timestampToSeconds, secondsToTimestamp } from './videoChunker'

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

export interface ChunkResult {
  chunkIndex: number
  chunkStartOffset: number // seconds - when this chunk starts in the original video
  result: VideoAnalysisResult
}

/**
 * Merge multiple chunk results into a single cohesive result
 */
export function mergeChunkResults(chunkResults: ChunkResult[]): VideoAnalysisResult {
  // Sort by chunk index to ensure proper order
  const sortedChunks = [...chunkResults].sort((a, b) => a.chunkIndex - b.chunkIndex)
  
  // Merge clean scripts
  const mergedScript = sortedChunks
    .map((chunk, idx) => {
      const header = idx === 0 ? '' : `\n\n--- Continuing from ${secondsToTimestamp(chunk.chunkStartOffset)} ---\n\n`
      return header + chunk.result.clean_script
    })
    .join('')
  
  // Merge and adjust chapter timestamps
  const mergedChapters = sortedChunks.flatMap(chunk => {
    return chunk.result.chapters.map(chapter => ({
      ...chapter,
      start_time: adjustTimestamp(chapter.start_time, chunk.chunkStartOffset),
      end_time: adjustTimestamp(chapter.end_time, chunk.chunkStartOffset)
    }))
  })
  
  // Deduplicate and merge important concepts
  const allConcepts = sortedChunks.flatMap(chunk => chunk.result.important_concepts)
  const mergedConcepts = deduplicateArray(allConcepts)
  
  // Deduplicate and merge recommended practice
  const allPractice = sortedChunks.flatMap(chunk => chunk.result.recommended_practice)
  const mergedPractice = deduplicateArray(allPractice)
  
  // Merge content metadata
  const mergedMetadata = mergeContentMetadata(sortedChunks)
  
  // Create combined summary
  const chunkSummaries = sortedChunks.map((chunk, idx) => 
    `Part ${idx + 1} (${secondsToTimestamp(chunk.chunkStartOffset)} onwards): ${chunk.result.full_session_summary}`
  ).join('\n\n')
  
  const mergedSummary = `This session was processed in ${sortedChunks.length} parts:\n\n${chunkSummaries}`
  
  return {
    clean_script: mergedScript,
    chapters: mergedChapters,
    full_session_summary: mergedSummary,
    important_concepts: mergedConcepts,
    recommended_practice: mergedPractice,
    content_metadata: mergedMetadata
  }
}

/**
 * Merge content metadata from all chunks
 */
function mergeContentMetadata(chunks: ChunkResult[]) {
  const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  
  // Calculate total durations
  let totalOriginalSeconds = 0
  let totalEssentialSeconds = 0
  let totalRemovedPercentage = 0
  
  sortedChunks.forEach(chunk => {
    const meta = chunk.result.content_metadata
    totalOriginalSeconds += parseDuration(meta.original_duration_estimate)
    totalEssentialSeconds += parseDuration(meta.essential_content_duration)
    totalRemovedPercentage += meta.content_removed_percentage
  })
  
  const avgRemovedPercentage = Math.round(totalRemovedPercentage / sortedChunks.length)
  
  // Merge filtered categories
  const categoryMap = new Map<string, { description: string; totalSeconds: number }>()
  
  sortedChunks.forEach(chunk => {
    chunk.result.content_metadata.filtered_categories.forEach(cat => {
      const duration = parseDuration(cat.approximate_duration)
      const existing = categoryMap.get(cat.category)
      
      if (existing) {
        existing.totalSeconds += duration
      } else {
        categoryMap.set(cat.category, {
          description: cat.description,
          totalSeconds: duration
        })
      }
    })
  })
  
  const mergedCategories = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    description: data.description,
    approximate_duration: formatDuration(data.totalSeconds)
  }))
  
  // Merge and adjust main content timestamps
  const mergedTimestamps = sortedChunks.flatMap(chunk => {
    return chunk.result.content_metadata.main_content_timestamps.map(ts => ({
      start: adjustTimestamp(ts.start, chunk.chunkStartOffset),
      end: adjustTimestamp(ts.end, chunk.chunkStartOffset),
      description: ts.description
    }))
  })
  
  return {
    original_duration_estimate: formatDuration(totalOriginalSeconds),
    essential_content_duration: formatDuration(totalEssentialSeconds),
    content_removed_percentage: avgRemovedPercentage,
    filtered_categories: mergedCategories,
    main_content_timestamps: mergedTimestamps
  }
}

/**
 * Parse duration string to seconds
 * Handles: MM:SS, HH:MM:SS, "X minutes", "~X minutes", "X min"
 */
function parseDuration(duration: string): number {
  if (!duration || duration === 'Unknown' || duration === 'unknown') return 0

  // Handle timestamp format (MM:SS or HH:MM:SS)
  if (duration.includes(':')) {
    const parts = duration.split(':').map(p => parseInt(p.trim())).filter(n => !isNaN(n))

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1]
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
  }

  // Handle text format like "5 minutes", "~5 min", "5min"
  const minuteMatch = duration.match(/~?(\d+)\s*(?:minutes?|min)/i)
  if (minuteMatch) {
    return parseInt(minuteMatch[1]) * 60
  }

  // Handle just a number (assume minutes)
  const numMatch = duration.match(/^~?(\d+)$/)
  if (numMatch) {
    return parseInt(numMatch[1]) * 60
  }

  return 0
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds: number): string {
  if (seconds === 0) return 'Unknown'
  return secondsToTimestamp(seconds)
}

/**
 * Deduplicate array with case-insensitive comparison and similarity matching
 */
function deduplicateArray(items: string[]): string[] {
  const seen = new Map<string, string>()
  
  items.forEach(item => {
    const normalized = item.toLowerCase().trim()
    if (!seen.has(normalized)) {
      seen.set(normalized, item)
    }
  })
  
  return Array.from(seen.values())
}

/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()
  
  if (s1 === s2) return 1.0
  
  // Simple word overlap similarity
  const words1 = new Set(s1.split(/\s+/))
  const words2 = new Set(s2.split(/\s+/))
  
  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])
  
  return intersection.size / union.size
}
