# Clean Class Recorder

AI-powered class recording analyzer that extracts clean teaching content from video recordings.

## Features

- **Upload Video**: Support for MP4, MKV, and MOV formats
- **AI Analysis**: Uses Google Gemini API to analyze video content
- **Content Extraction**: Removes Q&A, greetings, filler, pauses, and off-topic discussion
- **Chapter Generation**: Automatically splits content into chapters with timestamps
- **Summaries**: Generates chapter summaries and full session summary
- **Key Concepts**: Extracts important concepts and recommended practice
- **Export Options**: Download as JSON, clean script, or chapter list

## Setup

### 1. Install Dependencies

```bash
cd clean-class-recorder
npm install
```

### 2. Configure Environment

Create a `.env.local` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production

```bash
npm run build
npm start
```

## Usage

1. Open the application in your browser
2. Drag and drop a video file or click to browse
3. Click "Process with AI" to start analysis
4. View results in the tabbed interface:
   - **Clean Script**: Teaching-only content
   - **Chapters**: Timestamped chapters with summaries
   - **Full Summary**: Complete session overview
   - **Key Concepts**: Important topics and practice recommendations
5. Download results using the export buttons

## Telegram Bot

The system includes a Telegram bot for easy video processing on the go.

- **Features**: Upload videos directly from Telegram, receive summaries and trimmed clips.
- **Documentation**: See [README_BOT.md](./README_BOT.md) for setup and usage instructions.
- **Commands**: `/start`, `/settings`, `/status`, `/help`

## Tech Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI**: Google Gemini API

## Project Structure

```
clean-class-recorder/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Main dashboard
│   │   └── api/
│   │       └── process-video/
│   │           └── route.ts    # Video processing API
│   ├── components/
│   │   ├── FileUploader.tsx    # File upload component
│   │   ├── ResultViewer.tsx    # Results display
│   │   └── LoadingSpinner.tsx  # Loading state
│   └── lib/
│       └── utils.ts            # Utility functions
├── .env.local                  # Environment variables
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## API Response Format

```json
{
  "clean_script": "Teaching content only...",
  "chapters": [
    {
      "title": "Chapter Title",
      "start_time": "00:00:00",
      "end_time": "00:05:00",
      "summary": "Chapter summary...",
      "key_points": ["Point 1", "Point 2"]
    }
  ],
  "full_session_summary": "Complete session overview...",
  "important_concepts": ["Concept 1", "Concept 2"],
  "recommended_practice": ["Practice item 1", "Practice item 2"]
}
```

## Notes

- Large video files may take several minutes to process
- Video content is not stored permanently
- Requires valid Gemini API key with sufficient quota
- Uses Gemini 1.5 Flash model for fast video processing

## License

MIT
