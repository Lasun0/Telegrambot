/**
 * Process large files using Gemini Resumable Upload (Streaming)
 */
async function processWithFileAPI(
  videoPath: string,
  fileSize: number,
  mimeType: string,
  model: string,
  apiKey: string,
  onProgress: (progress: JobProgress) => Promise<void>
): Promise<any> {
  const uploadUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files'

  await onProgress({ stage: 'uploading', progress: 25, message: 'Initiating streaming upload...' })

  // 1. Start Resumable Upload using Axios
  const initResponse = await axios({
    url: `${uploadUrl}?key=${apiKey}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType
    },
    data: { file: { displayName: path.basename(videoPath) } }
  })

  const uploadUri = initResponse.headers['x-goog-upload-url']
  if (!uploadUri) throw new Error('Failed to get upload URL')

  await onProgress({ stage: 'uploading', progress: 35, message: 'Streaming video to Gemini...' })

  // 2. Stream the file directly from disk to the API using Axios
  const fileStream = fs.createReadStream(videoPath)

  const uploadResponse = await axios({
    url: uploadUri,
    method: 'PUT',
    headers: {
      'Content-Length': fileSize.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    data: fileStream,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })

  const uploadResult = uploadResponse.data
  const fileName = uploadResult.file?.name

  await onProgress({ stage: 'processing', progress: 50, message: 'Waiting for AI to process...' })
  await waitForFileReady(fileName, apiKey)

  await onProgress({ stage: 'analyzing', progress: 70, message: 'Analyzing with AI...' })

  // 3. Generate content from the uploaded file
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { file_data: { mime_type: mimeType, file_uri: uploadResult.file?.uri } },
          { text: getSystemInstruction() + '\n\nAnalyze this video.' }
        ]
      }],
      generation_config: { response_mime_type: 'application/json' }
    })
  })

  if (!response.ok) throw new Error(`Gemini API error: ${await response.text()}`)
  return parseGeminiResponse(await response.json())
}
