import {useCallback, useState} from 'react'
import {useDropzone} from 'react-dropzone'
import { formatSize } from '../lib/utils'

interface FileUploaderProps {
    file: File | null;
    onFileSelect?: (file: File | null) => void;
}

const FileUploader = ({ file, onFileSelect }: FileUploaderProps) => {
    const [rejectionMessage, setRejectionMessage] = useState('')
    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0] || null;
        setRejectionMessage('')
        onFileSelect?.(file);
    }, [onFileSelect]);

    const maxFileSize = 20 * 1024 * 1024; // 20MB in bytes

    const {getRootProps, getInputProps, isDragActive} = useDropzone({
        onDrop,
        onDropRejected: (rejections) => {
            setRejectionMessage(
                rejections[0]?.errors[0]?.code === 'file-too-large'
                    ? `PDFs must be smaller than ${formatSize(maxFileSize)}.`
                    : 'Choose a PDF file to continue.'
            )
        },
        multiple: false,
        accept: { 'application/pdf': ['.pdf']},
        maxSize: maxFileSize,
    })

    return (
        <div className="w-full">
            <div {...getRootProps({
                className: `uplader-drag-area border-2 border-dashed ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300'}`,
                'aria-label': 'Choose a PDF resume or drop it here',
            })}>
                <input {...getInputProps()} />

                <div className="space-y-4 cursor-pointer">
                    {file ? (
                        <div className="uploader-selected-file" onClick={(e) => e.stopPropagation()}>
                            <img src="/images/pdf.png" alt="pdf" className="size-10" />
                            <div className="flex items-center space-x-3">
                                <div>
                                    <p className="max-w-xs truncate text-sm font-medium text-gray-800">
                                        {file.name}
                                    </p>
                                    <p className="text-sm text-slate-500">
                                        {formatSize(file.size)}
                                    </p>
                                </div>
                            </div>
                            <button type="button" aria-label="Remove selected PDF" className="p-2 cursor-pointer" onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                onFileSelect?.(null)
                            }}>
                                <img src="/icons/cross.svg" alt="remove" className="w-4 h-4" />
                            </button>
                        </div>
                    ): (
                        <div>
                            <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-blue-50">
                                <img src="/icons/info.svg" alt="" className="size-8" />
                            </div>
                            <p className="text-base text-slate-700">
                                <span className="font-semibold">Choose a PDF</span> or drop it here
                            </p>
                            <p className="text-sm text-slate-500">Up to {formatSize(maxFileSize)}</p>
                        </div>
                    )}
                </div>
            </div>
            {rejectionMessage && (
                <p role="alert" className="mt-2 text-sm text-red-700">{rejectionMessage}</p>
            )}
        </div>
    )
}
export default FileUploader
