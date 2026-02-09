/**
 * Server-Side Video Trimmer
 * Uses native FFmpeg for fast video trimming (10-50x faster than browser WASM)
 */

import ffmpeg from 'fluent-ffmpeg'
import * as path from 'path'
import * as fs from 'fs'

// Set FFmpeg path from ffmpeg-installer
try {
  const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
  ffmpeg.setFfmpegPath(ffmpegPath)
  console.log('[FFmpeg] Using path:', ffmpegPath)
} catch (error) {
  console.warn('[FFmpeg] Could not load @ffmpeg-installer/ffmpeg, using system FFmpeg')
}

export interface VideoSegment {
  start: string  // Format: "MM:SS" or "HH:MM:SS"
  end: string
  description?: string
}

/**
 * Convert timestamp string to seconds
 */
function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(Number)

  if (parts.length === 2) {
    // MM:SS format
    return parts[0] * 60 + parts[1]
  } else if (parts.length === 3) {
    // HH:MM:SS format
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }

  return 0
}

/**
 * Convert seconds to FFmpeg timestamp format
 */
function secondsToTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Extract a single segment from video
 */
async function extractSegment(
  inputPath: string,
  start: number,
  duration: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(start)
      .setDuration(duration)
      .outputOptions([
        '-c', 'copy',      // Stream copy (no re-encoding) for speed
        '-avoid_negative_ts', '1'
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}

/**
 * Concatenate multiple video segments
 */
async function concatenateSegments(
  segmentPaths: string[],
  outputPath: string
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error('No segments to concatenate')
  }

  if (segmentPaths.length === 1) {
    // Just copy the single segment
    fs.copyFileSync(segmentPaths[0], outputPath)
    return
  }

  // Create concat file list
  const concatListPath = outputPath + '.txt'
  const concatContent = segmentPaths
    .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
    .join('\n')

  fs.writeFileSync(concatListPath, concatContent)

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('end', () => {
        // Cleanup concat list
        if (fs.existsSync(concatListPath)) {
          fs.unlinkSync(concatListPath)
        }
        resolve()
      })
      .on('error', (err) => {
        // Cleanup concat list
        if (fs.existsSync(concatListPath)) {
          fs.unlinkSync(concatListPath)
        }
        reject(err)
      })
      .run()
  })
}

/**
 * Trim video to essential content using FFmpeg
 *
 * @param inputPath - Path to input video
 * @param segments - Array of segments to keep
 * @param outputPath - Path for output video
 * @returns Promise that resolves when trimming is complete
 */
export async function trimVideoWithFFmpeg(
  inputPath: string,
  segments: VideoSegment[],
  outputPath: string
): Promise<void> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  if (segments.length === 0) {
    // No segments to extract, just copy the original
    fs.copyFileSync(inputPath, outputPath)
    return
  }

  console.log(`[FFmpeg] Trimming video with ${segments.length} segments`)

  // Create temp directory for segments
  const tempDir = path.join(path.dirname(outputPath), '.temp_segments')
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  const segmentPaths: string[] = []

  try {
    // Extract each segment
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const startSec = timestampToSeconds(segment.start)
      const endSec = timestampToSeconds(segment.end)
      const duration = endSec - startSec

      if (duration <= 0) {
        console.warn(`[FFmpeg] Skipping invalid segment: ${segment.start} - ${segment.end}`)
        continue
      }

      const segmentPath = path.join(tempDir, `segment_${i.toString().padStart(3, '0')}.mp4`)
      segmentPaths.push(segmentPath)

      console.log(`[FFmpeg] Extracting segment ${i + 1}/${segments.length}: ${segment.start} - ${segment.end}`)

      await extractSegment(inputPath, startSec, duration, segmentPath)
    }

    if (segmentPaths.length === 0) {
      throw new Error('No valid segments to extract')
    }

    // Concatenate all segments
    console.log(`[FFmpeg] Concatenating ${segmentPaths.length} segments`)
    await concatenateSegments(segmentPaths, outputPath)

    console.log(`[FFmpeg] Trimming complete: ${outputPath}`)

  } finally {
    // Cleanup temp segments
    for (const segmentPath of segmentPaths) {
      if (fs.existsSync(segmentPath)) {
        fs.unlinkSync(segmentPath)
      }
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir)
    }
  }
}

/**
 * Get video duration in seconds
 */
export function getVideoDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err)
        return
      }

      const duration = metadata.format.duration || 0
      resolve(duration)
    })
  })
}

/**
 * Get video metadata
 */
export function getVideoMetadata(inputPath: string): Promise<{
  duration: number
  width: number
  height: number
  codec: string
  bitrate: number
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err)
        return
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video')

      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        codec: videoStream?.codec_name || 'unknown',
        bitrate: metadata.format.bit_rate ? parseInt(String(metadata.format.bit_rate)) : 0
      })
    })
  })
}
