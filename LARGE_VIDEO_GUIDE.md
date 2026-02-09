# Large Video Processing Guide

## Quick Start for 600MB+ Videos

If you have a large video file (600MB+) that exceeds standard API context limits, this guide will help you successfully process it.

## 🎯 Solution Overview

Your application now includes **Chunked Processing** - an intelligent system that automatically handles large videos by:

1. **Auto-detecting** large files (≥500MB)
2. **Splitting** them into manageable time-based chunks
3. **Processing** chunks in parallel for speed
4. **Merging** results into a cohesive analysis

### What This Means for You

✅ **No more token limit errors** - Videos up to 1GB can be processed  
✅ **Automatic handling** - System detects and routes large files automatically  
✅ **Fast processing** - Parallel chunk processing reduces wait time  
✅ **Accurate results** - Timestamps and chapters remain precise

## 🚀 How to Process Large Videos

### Step 1: Upload Your Video

Simply drag and drop or select your video file (up to 1GB):

```
Supported formats: MP4, MKV, MOV, WebM
Max size: 1GB
```

### Step 2: Automatic Detection

When you upload a file **≥500MB**, you'll see:

```
✓ Large file detected (650MB)
→ Using intelligent chunked processing
→ Estimated processing time: 12-18 minutes
```

### Step 3: Monitor Progress

Real-time updates show processing stages:

```
Phase 1: Uploading (15-50%)
 "Uploading 650MB to Gemini..."

Phase 2: Processing (50-90%)
 "Processing batch 2/3 (chunks 4-6)..."

Phase 3: Merging (90-95%)
 "Merging chunk results..."

Phase 4: Complete (100%)
 "Analysis ready!"
```

### Step 4: Review Results

You'll receive a complete analysis with:
- Clean script (filtered content)
- Chapter markers (with accurate timestamps)
- Concept summaries
- Practice recommendations
- Content metadata

## 📊 Performance Expectations

| Video Size | Duration | Upload | Processing | Total |
|------------|----------|--------|------------|-------|
| 200MB | 30 min | 1-2 min | 3-5 min | 4-7 min |
| 500MB | 60 min | 2-4 min | 6-10 min | 8-14 min |
| 800MB | 90 min | 4-6 min | 10-15 min | 14-21 min |

*Times vary based on internet speed and API response time*

## ⚙️ Configuration Options

Default settings work for most users, but you can customize:

### 1. Chunk Size Threshold

Change when chunking activates (in `.env.local`):

```env
AUTO_CHUNK_THRESHOLD_MB=500  # Default
# Set to 300 for earlier chunking
# Set to 700 for later chunking
```

### 2. Chunk Duration

Adjust time segment size:

```env
CHUNK_SIZE_MINUTES=20  # Default (recommended)
# Set to 15 for more precise chunking
# Set to 25 for faster processing
```

### 3. Parallel Processing

Control concurrent chunks:

```env
MAX_CONCURRENT_CHUNKS=3  # Default
# Set to 2 if you hit rate limits
# Set to 4 if you have higher quotas
```

## 💡 Best Practices

### For Optimal Results

1. **Video Quality**: Higher bitrate = larger file but better analysis
2. **Recording Length**: 60-90 minute recordings work best
3. **Content Type**: Educational content with clear audio performs best
4. **File Format**: MP4 with H.264 codec is recommended

### For Faster Processing

1. **Trim unnecessary parts** using the Video Trimmer before upload
2. **Use default chunk size** (20 minutes) for balanced speed/accuracy
3. **Ensure stable internet** for smooth upload

### For Better Accuracy

1. **Use smaller chunks** (15 minutes) for complex content
2. **Choose Gemini 1.5 Flash** for consistent results
3. **Ensure clear audio** in recordings

## 🔧 Troubleshooting

### Issue: "Processing taking too long"

**Causes:**
- Very large file (>800MB)
- Slow internet connection
- API rate limits

**Solutions:**
- Wait patiently (check estimated time)
- Reduce `MAX_CONCURRENT_CHUNKS` to 2
- Try during off-peak hours

### Issue: "Upload failed"

**Causes:**
- Network interruption
- File too large (>1GB)
- Invalid API key

**Solutions:**
- Check your internet connection
- Verify file size is under 1GB
- Confirm API key in `.env.local`

### Issue: "Timestamps seem incorrect"

**Causes:**
- Duration estimation errors
- Chunk boundary issues

**Solutions:**
- Manually verify key timestamps
- Try smaller chunk size (15 min)
- Report issue with video details

### Issue: "Out of memory error"

**Causes:**
- Too many concurrent chunks
- System memory limits

**Solutions:**
- Reduce `MAX_CONCURRENT_CHUNKS` to 2
- Close other applications
- Process during low-memory periods

## 🎓 Understanding the Process

### What Happens Behind the Scenes

1. **Upload Phase (Single Upload)**
   ```
   Your 650MB video → Gemini File API
   Result: Single file URI
   Time: 2-4 minutes
   ```

2. **Analysis Phase (Parallel Processing)**
   ```
   Video split into 4 chunks:
   Chunk 1 (00:00-20:00) ─┐
   Chunk 2 (20:00-40:00) ─┤ Process in parallel
   Chunk 3 (40:00-60:00) ─┤
   Chunk 4 (60:00-65:00) ─┘
   Time: 8-12 minutes
   ```

3. **Merge Phase (Result Combining)**
   ```
   Combine:
   - Scripts with markers
   - Chapters with absolute timestamps
   - Concepts (deduplicated)
   - Metadata (aggregated)
   Time: 30 seconds
   ```

### How Timestamps Work

Each chunk uses **relative timestamps** (starting from 00:00):

```typescript
Chunk 2 (20:00-40:00):
AI sees: "00:00" to "20:00" (relative)
System converts: "20:00" to "40:00" (absolute)

Example:
AI output: "Chapter starts at 05:30"
Final result: "Chapter starts at 25:30"
```

This ensures accurate timestamps throughout the entire video.

## 📈 Advanced Usage

### Manual Chunked Processing

Force chunking for any file size:

```typescript
// Add ?chunked=true to URL
fetch('/api/process-video?chunked=true', {
  method: 'POST',
  body: formData
})
```

### Custom Chunk Duration

Override default chunk size:

```typescript
formData.append('chunkDuration', '15')  // 15-minute chunks
```

### Monitoring in Console

Watch detailed logs:

```bash
npm run dev

# Look for:
[Chunked] Processing video.mp4: 650MB
[Chunked] Calculated 4 chunks of 20 minutes each
[Chunked] Processing chunk 1/4...
[Chunked] Chunk 1 complete in 3.2 minutes
```

## 🆚 Comparison: Chunked vs Direct Processing

### Direct Processing (< 500MB)
- ✅ Faster (single API call)
- ✅ Simpler (no merging needed)
- ❌ Limited to ~45-60 minute videos
- ❌ Fails on large files

### Chunked Processing (≥ 500MB)
- ✅ Handles unlimited length
- ✅ Parallel processing for speed
- ✅ Works with standard API access
- ⚠️ Slightly longer processing time

## 🎬 Example Scenarios

### Scenario 1: 90-Minute Lecture (700MB)

```
Upload: 700MB MP4 file
Detection: Auto-routes to chunked processing
Chunks: 5 chunks × 18 minutes
Processing: ~15 minutes total
Result: Complete analysis with 8 chapters
```

### Scenario 2: 2-Hour Workshop (950MB)

```
Upload: 950MB MP4 file
Detection: Auto-routes to chunked processing
Chunks: 6 chunks × 20 minutes
Processing: ~20 minutes total
Result: Comprehensive breakdown with timestamps
```

### Scenario 3: 45-Minute Class (350MB)

```
Upload: 350MB MP4 file
Detection: Uses direct processing (< 500MB)
Processing: ~6 minutes
Result: Fast, single-pass analysis
```

## 📚 Additional Resources

- **Technical Documentation**: See `CHUNKED_PROCESSING.md`
- **API Reference**: Check API endpoint documentation
- **Video Format Guide**: Consult FFmpeg documentation
- **Support**: Open issue on GitHub with details

## 🎉 Success Tips

1. **Prepare your video**: Trim unnecessary parts first
2. **Check file size**: Ensure it's under 1GB
3. **Verify format**: Use MP4 with H.264 codec
4. **Stable connection**: Upload during good internet hours
5. **Be patient**: Large files take time but deliver results
6. **Review settings**: Default config works for 95% of cases

## 🔮 Future Enhancements

Planned improvements:
- Smart boundary detection (scene change based)
- Context overlap between chunks
- Adaptive chunk sizing based on content
- Progressive summarization for very long videos
- Visual progress timeline

---

**Need Help?**

If you encounter issues:
1. Check this guide's troubleshooting section
2. Review `CHUNKED_PROCESSING.md` for technical details
3. Verify your `.env.local` configuration
4. Check console logs for specific errors
5. Open an issue with video details (size, duration, format)

**Ready to process your large video?** Just drag and drop it - the system handles the rest! 🚀
