'use client'

import { useState, useRef, useCallback } from 'react'
import { formatFileSize } from '@/lib/utils'
import ModelSelector from './ModelSelector'

interface FileUploaderProps {
  onFileSelect: (file: File, modelId: string) => void
  isProcessing: boolean
  uploadProgress?: number
  fileInputRef?: React.RefObject<HTMLInputElement | null>
}

const MAX_FILE_SIZE = 1024 * 1024 * 1024 // 1GB - supports large live recordings

export default function FileUploader({ onFileSelect, isProcessing, uploadProgress = 0, fileInputRef: externalInputRef }: FileUploaderProps) {
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash')
  const internalInputRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef || internalInputRef

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    setValidationError(null)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (validateFile(file)) {
        setSelectedFile(file)
      }
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    setValidationError(null)
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (validateFile(file)) {
        setSelectedFile(file)
      }
    }
  }

  const validateFile = (file: File): boolean => {
    const allowedTypes = ['video/mp4', 'video/x-matroska', 'video/quicktime', 'video/webm']

    if (!allowedTypes.includes(file.type)) {
      setValidationError('Invalid file type. Please upload MP4, MKV, MOV, or WebM files.')
      return false
    }

    if (file.size > MAX_FILE_SIZE) {
      setValidationError(`File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`)
      return false
    }

    return true
  }

  const handleUpload = () => {
    if (selectedFile) {
      onFileSelect(selectedFile, selectedModel)
    }
  }

  const isMiraModel = selectedModel.startsWith('mira:')

  const getFileSizeWarning = (size: number): { message: string; type: 'warning' | 'info' } | null => {
    if (isMiraModel && size > 20 * 1024 * 1024) {
      return {
        message: `Large video (${formatFileSize(size)}) with MiraAI - this may fail depending on the model's limits. Gemini is recommended for large files.`,
        type: 'warning'
      }
    }
    if (size > 500 * 1024 * 1024) {
      return {
        message: 'Large file detected (500MB+). Upload and processing may take several minutes.',
        type: 'warning'
      }
    }
    if (size > 20 * 1024 * 1024) {
      return {
        message: 'This file will be uploaded using Gemini File API for optimal processing.',
        type: 'info'
      }
    }
    if (size > 10 * 1024 * 1024) {
      return {
        message: 'This file may take a minute to process.',
        type: 'info'
      }
    }
    return null
  }

  const fileSizeWarning = selectedFile ? getFileSizeWarning(selectedFile.size) : null

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${dragActive
          ? 'border-primary-500 bg-primary-50'
          : validationError
            ? 'border-red-300 bg-red-50'
            : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
          } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp4,.mkv,.mov,.webm,video/mp4,video/x-matroska,video/quicktime,video/webm"
          onChange={handleChange}
          className="hidden"
          disabled={isProcessing}
        />

        <div className="space-y-4">
          <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${validationError ? 'bg-red-100' : 'bg-primary-100'
            }`}>
            {validationError ? (
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg
                className="w-8 h-8 text-primary-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            )}
          </div>

          <div>
            {validationError ? (
              <p className="text-lg font-medium text-red-700">{validationError}</p>
            ) : (
              <>
                <p className="text-lg font-medium text-gray-700">
                  {selectedFile ? 'Video Ready' : 'Drag and drop your class recording here'}
                </p>
                {!selectedFile && (
                  <p className="text-sm text-gray-500 mt-1">
                    or{' '}
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      className="text-primary-600 hover:text-primary-700 font-medium"
                      disabled={isProcessing}
                    >
                      browse files
                    </button>
                  </p>
                )}
              </>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Supported formats: MP4, MKV, MOV, WebM (up to 1GB for live recordings)
            </p>
          </div>
        </div>
      </div>

      {selectedFile && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 truncate max-w-xs">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-gray-500">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            {!isProcessing && (
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null)
                  setValidationError(null)
                }}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Model Selection - NOW SHOWN AFTER FILE UPLOAD */}
          {!isProcessing && (
            <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
              <ModelSelector
                selectedModel={selectedModel}
                onModelChange={setSelectedModel}
                disabled={isProcessing}
              />
            </div>
          )}

          {/* File size warning */}
          {fileSizeWarning && !isProcessing && (
            <div className={`mt-3 flex items-start space-x-2 p-2 rounded-md ${fileSizeWarning.type === 'warning'
              ? 'text-amber-600 bg-amber-50'
              : 'text-blue-600 bg-blue-50'
              }`}>
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                {fileSizeWarning.type === 'warning' ? (
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                ) : (
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                )}
              </svg>
              <p className="text-xs">{fileSizeWarning.message}</p>
            </div>
          )}

          {/* Upload progress bar */}
          {isProcessing && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Uploading...</span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleUpload}
            disabled={isProcessing}
            className="mt-4 w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2"
          >
            {isProcessing ? (
              <>
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <span>Extract Learning Content</span>
              </>
            )}
          </button>

          {/* Feature highlights */}
          {!isProcessing && (
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-gray-500">
              <div className="flex items-center space-x-1">
                <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Removes filler content</span>
              </div>
              <div className="flex items-center space-x-1">
                <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Creates chapters</span>
              </div>
              <div className="flex items-center space-x-1">
                <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Extracts key concepts</span>
              </div>
              <div className="flex items-center space-x-1">
                <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>Generates summaries</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
