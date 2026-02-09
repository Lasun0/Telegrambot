# Chunked Video Processing Solution

## Overview

This document describes the **Chunked Processing** feature that enables analysis of large video files (600MB+) that exceed the standard Gemini API's context window limitations.

## Problem Statement

- Standard Gemini models have a **1 million token context window** (~45-60 minute videos)
- Large class recordings (600MB+, 60+ minutes) exceed this limit
- Gemini 1.5 Pro (2M context) may not be available via all API access levels
- Direct upload of large videos would result in token limit errors

## Solution Architecture

### 1. **Automatic Smart Routing**
The system automatically detects large files and routes them to chunked processing:

```typescript
// Auto-routing threshold (default: 500MB)
if (fileSize > AUTO_CHUNK_THRESHOLD_MB) {
  // Route to /api/process-video-chunked
}
```

### 2. **Intelligent Video Chunking**

**File:** `src/lib/videoChunker.ts`

- Splits video into temporal segments (default: 20-minute chunks)
- No actual video splitting - uses timestamp ranges with Gemini File API
- Estimates duration based on file size and bitrate
- Calculates optimal chunk boundaries

```typescript
// Example: 90-minute video → 5 chunks of 18 minutes each
const chunks = calculateChunkStrategy(file, estimatedDuration, {
  chunkDurationMinutes: 20
})
```

### 3. **Parallel Batch Processing**

**File:** `src/app/api/process-video-chunked/route.ts`

- Uploads video once to Gemini File API
- Processes multiple chunks in parallel (default: 3 concurrent)
- Each chunk gets analyzed independently with context-aware prompts
- Chunks use relative timestamps (00:00 start)

```typescript
// Process in batches of 3 chunks at a time
for (let i = 0; i < chunks.length; i += MAX_CONCURRENT_CHUNKS) {
  const batch = chunks.slice(i, i + MAX_CONCURRENT_CHUNKS)
  const batchResults = await Promise.all(
    batch.map(chunk => processChunk(fileUri, chunk, modelId))
  )
  chunkResults.push(...batchResults)
}
```

### 4. **Intelligent Result Merging**

**File:** `src/lib/resultMerger.ts`

Combines chunk results into cohesive output:

- **Scripts**: Concatenated with continuation markers
- **Timestamps**: Adjusted from relative to absolute time
- **Chapters**: Merged and time-adjusted
- **Concepts**: Deduplicated intelligently
- **Metadata**: Aggregated (durations, percentages)

```typescript
const mergedResult = mergeChunkResults(chunkResults)
// Output: Single VideoAnalysisResult with absolute timestamps
```

## Configuration

### Environment Variables (.env.local)

```env
# Chunked Processing Configuration
AUTO_CHUNK_THRESHOLD_MB=500        # Auto-enable chunking for files > 500MB
CHUNK_SIZE_MINUTES=20              # Duration of each chunk
MAX_CONCURRENT_CHUNKS=3            # Parallel processing limit
ENABLE_SUMMARY_MERGE_PASS=false    # Optional: AI-powered final merge
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_CHUNK_THRESHOLD_MB` | 500 | File size threshold for automatic chunking |
| `CHUNK_SIZE_MINUTES` | 20 | Duration of each video chunk |
| `MAX_CONCURRENT_CHUNKS` | 3 | Number of chunks processed in parallel |
| `ENABLE_SUMMARY_MERGE_PASS` | false | Use AI to create final summary (future) |

## How It Works: Step-by-Step

### Step 1: File Upload & Detection
```
User uploads 600MB video (90 minutes)
↓
System detects: fileSize > 500MB
↓
Auto-route to chunked processing
```

### Step 2: Chunk Calculation
```
Estimated duration: 90 minutes
Chunk size: 20 minutes
↓
Chunks created:
- Chunk 1: 00:00 - 20:00
- Chunk 2: 20:00 - 40:00
- Chunk 3: 40:00 - 60:00
- Chunk 4: 60:00 - 80:00
- Chunk 5: 80:00 - 90:00
```

### Step 3: Upload Once
```
Upload 600MB video to Gemini File API
↓
Receive fileUri: "https://generativelanguage.googleapis.com/v1beta/files/xyz"
↓
Wait for Gemini to process video
```

### Step 4: Parallel Processing
```
Batch 1 (parallel):
- Process Chunk 1 (00:00-20:00)
- Process Chunk 2 (20:00-40:00)
- Process Chunk 3 (40:00-60:00)

Batch 2 (parallel):
- Process Chunk 4 (60:00-80:00)
- Process Chunk 5 (80:00-90:00)
```

Each chunk receives:
```json
{
  "prompt": "Analyze segment from 20:00 to 40:00",
  "file_uri": "https://.../files/xyz",
  "instruction": "Use relative timestamps starting from 00:00"
}
```

### Step 5: Result Merging
```
Chunk Results:
- Chunk 1: chapters with timestamps 00:00-20:00
- Chunk 2: chapters with timestamps 00:00-20:00 (relative)
↓
Merge & Adjust:
- Chunk 1 chapters: keep as-is
- Chunk 2 chapters: add 20:00 offset
↓
Final Result: Unified chapters with absolute timestamps
```

## API Endpoints

### 1. Main Processing Endpoint
**POST** `/api/process-video`

Automatically routes based on file size:
- Small files (< 500MB): Direct processing
- Large files (≥ 500MB): Chunked processing

### 2. Chunked Processing Endpoint
**POST** `/api/process-video-chunked`

Explicitly uses chunked processing:
```typescript
// Manual chunked processing
const response = await fetch('/api/process-video-chunked', {
  method: 'POST',
  body: formData
})
```

Parameters:
- `video`: Video file (File)
- `model`: Model ID (string)
- `chunkDuration`: Optional chunk size in minutes (number)

## Progress Tracking

The system provides real-time progress updates via Server-Sent Events (SSE):

```typescript
// Progress stages
1. initializing (5%)    - "Preparing chunked processing..."
2. planning (10%)       - "Video will be split into 5 chunks..."
3. uploading (15-50%)   - "Uploading video to Gemini..."
4. processing (50-90%)  - "Processing batch 2/3 (chunks 4-6)..."
5. merging (90-95%)     - "Merging chunk results..."
6. complete (100%)      - Analysis ready
```

## Performance Characteristics

### Upload Phase
- **Single Upload**: Video uploaded once, regardless of chunk count
- **Resumable**: Uses resumable upload for files > 50MB
- **Chunked Transfer**: 64MB upload chunks for large files

### Processing Phase
- **Parallel**: 3 chunks processed simultaneously (configurable)
- **Duration**: ~2-4 minutes per 20-minute chunk
- **Scalability**: Linear scaling with video length

### Example Timings

| Video Size | Duration | Chunks | Upload Time | Process Time | Total Time |
|------------|----------|--------|-------------|--------------|------------|
| 200MB | 30 min | 2 | 1-2 min | 3-5 min | 4-7 min |
| 500MB | 60 min | 3 | 2-4 min | 6-10 min | 8-14 min |
| 800MB | 90 min | 5 | 4-6 min | 10-15 min | 14-21 min |

## Advantages Over Alternatives

### ✅ Chunked Processing (Implemented)
- Works with standard Gemini API access
- No Gemini 1.5 Pro required
- Handles unlimited video length
- Parallel processing for speed
- Accurate timestamp preservation

### ❌ Frame Sampling
- Loses temporal context
- Misses nuanced content
- Poor for educational content
- No audio analysis

### ❌ Audio-Only Processing
- Misses visual demonstrations
- No code/diagram analysis
- Loses important context

### ❌ External Storage + URL
- Still hits context limits
- Adds complexity
- No benefit for large files

## Limitations & Considerations

### Current Limitations
1. **Chunk Boundaries**: Fixed time intervals (no content-aware splitting)
2. **Cross-Chunk Context**: Each chunk analyzed independently
3. **Memory Usage**: Multiple concurrent API calls

### Future Enhancements
1. **Smart Boundaries**: Detect scene changes for optimal chunking
2. **Context Overlap**: Provide previous chunk summary to next chunk
3. **Progressive Summarization**: Multi-level summarization for very long videos
4. **Adaptive Chunking**: Adjust chunk size based on content density

## Usage Examples

### Example 1: Automatic Chunking
```typescript
// Upload 600MB video - automatically uses chunked processing
const formData = new FormData()
formData.append('video', file)
formData.append('model', 'gemini-1.5-flash')

const response = await fetch('/api/process-video', {
  method: 'POST',
  headers: { 'Accept': 'text/event-stream' },
  body: formData
})

// Receives progress updates via SSE
const eventSource = new EventSource(...)
```

### Example 2: Manual Chunked Processing
```typescript
// Force chunked processing for any file size
const response = await fetch('/api/process-video?chunked=true', {
  method: 'POST',
  body: formData
})
```

### Example 3: Custom Chunk Size
```typescript
// Use 15-minute chunks instead of default 20
formData.append('chunkDuration', '15')

const response = await fetch('/api/process-video-chunked', {
  method: 'POST',
  body: formData
})
```

## Monitoring & Debugging

### Server Logs
```bash
# Watch chunked processing logs
npm run dev

# Look for:
[Chunked] Processing video.mp4: 650MB with 20min chunks
[Chunked] Calculated 4 chunks
[Chunked] Processing chunk 1/4
[Chunked] Chunk 1 processed successfully
[Chunked] Processing chunk 2/4
...
```

### Progress Events
```typescript
eventSource.addEventListener('progress', (event) => {
  const data = JSON.parse(event.data)
  console.log(`Stage: ${data.stage}, Progress: ${data.progress}%`)
  console.log(`Message: ${data.message}`)
})
```

## Testing

### Test Cases

1. **Small File (< 500MB)**
   - Should use direct processing
   - No chunking applied

2. **Large File (> 500MB)**
   - Should auto-route to chunked processing
   - Verify chunk count calculation
   - Check timestamp adjustment

3. **Very Large File (> 800MB)**
   - Test parallel processing
   - Verify memory efficiency
   - Check upload chunking

### Manual Testing
```bash
# 1. Start development server
npm run dev

# 2. Upload test videos of various sizes
# - 200MB video (expected: direct processing)
# - 600MB video (expected: chunked processing)
# - 900MB video (expected: chunked with parallel batches)

# 3. Monitor console for routing decisions
# 4. Verify result timestamps are absolute
# 5. Check chapter continuity across chunks
```

## Troubleshooting

### Issue: Chunked processing not triggered
**Solution**: Check `AUTO_CHUNK_THRESHOLD_MB` in `.env.local`

### Issue: Upload fails for large files
**Solution**: 
- Verify Gemini API key is valid
- Check file size < 1GB limit
- Review server timeout settings

### Issue: Timestamps are incorrect
**Solution**:
- Verify `videoChunker.ts` timestamp adjustment
- Check `resultMerger.ts` chunk offset application

### Issue: Out of memory errors
**Solution**:
- Reduce `MAX_CONCURRENT_CHUNKS` (try 2 instead of 3)
- Increase server memory allocation
- Use smaller `CHUNK_SIZE_MINUTES`

## Technical Implementation Details

### Timestamp Handling
```typescript
// Chunk 2 starts at 20:00 (1200 seconds offset)
const chunkStartOffset = 1200

// AI returns relative timestamp: "05:30" (330 seconds)
const relativeTimestamp = "05:30"

// Convert to absolute: 1200 + 330 = 1530 seconds = "25:30"
const absoluteTimestamp = adjustTimestamp(relativeTimestamp, chunkStartOffset)
```

### Deduplication Strategy
```typescript
// Merge concepts from all chunks
const allConcepts = chunks.flatMap(c => c.important_concepts)

// Deduplicate with case-insensitive comparison
const uniqueConcepts = deduplicateArray(allConcepts)
// ["Variables", "variables", "VARIABLES"] → ["Variables"]
```

### Memory Management
```typescript
// Upload: Stream video in 64MB chunks
const CHUNK_SIZE = 64 * 1024 * 1024

// Processing: Limit concurrent API calls
const MAX_CONCURRENT = 3

// Result: Merge incrementally, not all at once
for (const batch of chunks) {
  const results = await processBatch(batch)
  mergedResults.push(...results)
  // Previous batch can be garbage collected
}
```

## Conclusion

The Chunked Processing solution enables comprehensive analysis of large educational videos without requiring access to models with extended context windows. By intelligently splitting, processing in parallel, and merging results, the system maintains accuracy while staying within API limitations.

**Key Benefits:**
- ✅ Works with standard Gemini API
- ✅ Handles unlimited video length
- ✅ Maintains timestamp accuracy
- ✅ Fast parallel processing
- ✅ Automatic routing

**Best For:**
- Long class recordings (60+ minutes)
- Large file sizes (500MB+)
- Users without Gemini 1.5 Pro access
- Comprehensive educational content analysis
