/**
 * Video Chunker Utility
 * Handles splitting large videos into smaller chunks for parallel processing
 */

export interface ChunkMetadata {
  index: number
  startTime: number // seconds
  endTime: number // seconds
  duration: number // seconds
  fileName: string
}

export interface ChunkingConfig {
  chunkDurationMinutes: number
  maxFileSize: number // bytes
  overlapSeconds?: number // overlap between chunks for context
}

/**
 * Calculate optimal chunk configuration based on video properties
 */
export function calculateChunkStrategy(
  videoFile: File,
  videoDurationSeconds: number,
  config: Partial<ChunkingConfig> = {}
): ChunkMetadata[] {
  const chunkDurationMinutes = config.chunkDurationMinutes || 20
  const overlapSeconds = config.overlapSeconds || 5 // 5 second overlap for context
  
  const chunkDurationSeconds = chunkDurationMinutes * 60
  const totalDuration = videoDurationSeconds
  
  // Calculate number of chunks needed
  const numChunks = Math.ceil(totalDuration / chunkDurationSeconds)
  
  const chunks: ChunkMetadata[] = []
  
  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDurationSeconds
    const endTime = Math.min((i + 1) * chunkDurationSeconds + overlapSeconds, totalDuration)
    
    chunks.push({
      index: i,
      startTime,
      endTime,
      duration: endTime - startTime,
      fileName: `chunk_${i}.mp4`
    })
  }
  
  return chunks
}

/**
 * Estimate video duration from file size (rough heuristic)
 * More accurate duration will be obtained after actual processing
 */
export function estimateVideoDuration(fileSizeBytes: number): number {
  // Rough estimate: assume 1GB = 60 minutes at typical quality
  // This is just for initial planning, actual duration will be determined during processing
  const sizeMB = fileSizeBytes / (1024 * 1024)
  const estimatedMinutes = sizeMB / 16 // ~16MB per minute for typical class recordings
  return estimatedMinutes * 60 // return in seconds
}

/**
 * Convert seconds to HH:MM:SS format
 */
export function secondsToTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * Convert timestamp to seconds
 */
export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number)
  
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1]
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  
  return 0
}

/**
 * Adjust timestamp by adding an offset (for chunk merging)
 */
export function adjustTimestamp(timestamp: string, offsetSeconds: number): string {
  const seconds = timestampToSeconds(timestamp)
  const adjusted = seconds + offsetSeconds
  return secondsToTimestamp(adjusted)
}
