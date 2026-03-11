import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

interface PdfViewerProps {
    url: string
    className?: string
}

export default function PdfViewer({ url, className }: PdfViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [pageCount, setPageCount] = useState(0)

    useEffect(() => {
        if (!url) return

        let cancelled = false

        async function renderPdf() {
            try {
                setLoading(true)
                setError('')

                const pdf = await pdfjsLib.getDocument(url).promise
                if (cancelled) return

                setPageCount(pdf.numPages)

                const container = containerRef.current
                if (!container) return

                // Clear previous renders
                container.innerHTML = ''

                const containerWidth = container.clientWidth || 600

                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum)
                    if (cancelled) return

                    const viewport = page.getViewport({ scale: 1 })
                    // Scale to fit container width with some padding
                    const scale = (containerWidth - 16) / viewport.width
                    const scaledViewport = page.getViewport({ scale })

                    const canvas = document.createElement('canvas')
                    canvas.width = scaledViewport.width
                    canvas.height = scaledViewport.height
                    canvas.style.display = 'block'
                    canvas.style.margin = '0 auto 8px auto'
                    canvas.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)'
                    canvas.style.borderRadius = '2px'

                    container.appendChild(canvas)

                    const ctx = canvas.getContext('2d')!
                    await page.render({
                        canvasContext: ctx,
                        viewport: scaledViewport
                    }).promise
                }

                setLoading(false)
            } catch (err: any) {
                if (!cancelled) {
                    console.error('[PdfViewer] Error rendering PDF:', err)
                    setError('Impossibile visualizzare il PDF')
                    setLoading(false)
                }
            }
        }

        renderPdf()
        return () => { cancelled = true }
    }, [url])

    return (
        <div className={className}>
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-600 mx-auto mb-3"></div>
                        <p className="text-gray-500 text-sm">Caricamento PDF...</p>
                    </div>
                </div>
            )}

            {error && (
                <div className="text-center py-8">
                    <p className="text-red-500 text-sm mb-3">{error}</p>
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-yellow-700 underline text-sm"
                    >
                        Apri PDF in una nuova scheda
                    </a>
                </div>
            )}

            <div
                ref={containerRef}
                style={{ maxHeight: '70vh', overflowY: 'auto', padding: '8px', background: '#f3f4f6' }}
            />

            {!loading && !error && pageCount > 0 && (
                <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-t text-xs text-gray-500">
                    <span>{pageCount} {pageCount === 1 ? 'pagina' : 'pagine'}</span>
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-yellow-700 hover:text-yellow-800 underline"
                    >
                        Apri in nuova scheda
                    </a>
                </div>
            )}
        </div>
    )
}
