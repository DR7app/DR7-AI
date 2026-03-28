import { useEffect, useRef, useState, useCallback } from 'react'
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
    const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
    const renderedPagesRef = useRef<Set<number>>(new Set())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [pageCount, setPageCount] = useState(0)

    // Clear container properly without innerHTML
    const clearContainer = useCallback((container: HTMLDivElement) => {
        while (container.firstChild) {
            container.removeChild(container.firstChild)
        }
        renderedPagesRef.current.clear()
    }, [])

    // Render a single page into its placeholder
    const renderPage = useCallback(async (pageNum: number, placeholder: HTMLDivElement, containerWidth: number) => {
        if (renderedPagesRef.current.has(pageNum) || !pdfRef.current) return

        try {
            const page = await pdfRef.current.getPage(pageNum)
            const viewport = page.getViewport({ scale: 1 })
            const scale = (containerWidth - 16) / viewport.width
            const scaledViewport = page.getViewport({ scale })

            const canvas = document.createElement('canvas')
            canvas.width = scaledViewport.width
            canvas.height = scaledViewport.height
            canvas.style.display = 'block'
            canvas.style.margin = '0 auto'
            canvas.style.boxShadow = '0 1px 3px rgba(0,0,0,0.12)'
            canvas.style.borderRadius = '2px'

            // Replace placeholder content with canvas
            while (placeholder.firstChild) {
                placeholder.removeChild(placeholder.firstChild)
            }
            placeholder.appendChild(canvas)

            const ctx = canvas.getContext('2d')!
            await page.render({
                canvasContext: ctx,
                viewport: scaledViewport,
                canvas
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any).promise

            renderedPagesRef.current.add(pageNum)
        } catch {
            // Page render failed silently — user can still open in new tab
        }
    }, [])

    useEffect(() => {
        if (!url) return

        let cancelled = false

        async function loadPdf() {
            try {
                setLoading(true)
                setError('')

                const pdf = await pdfjsLib.getDocument(url).promise
                if (cancelled) return

                pdfRef.current = pdf
                setPageCount(pdf.numPages)

                const container = containerRef.current
                if (!container) return

                clearContainer(container)

                const containerWidth = container.clientWidth || 600

                // Create placeholders for all pages, render first 3 immediately
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum)
                    if (cancelled) return

                    const viewport = page.getViewport({ scale: 1 })
                    const scale = (containerWidth - 16) / viewport.width
                    const scaledViewport = page.getViewport({ scale })

                    const placeholder = document.createElement('div')
                    placeholder.dataset.pageNum = String(pageNum)
                    placeholder.style.minHeight = `${scaledViewport.height}px`
                    placeholder.style.marginBottom = '8px'
                    placeholder.style.background = '#e5e7eb'
                    placeholder.style.borderRadius = '2px'
                    placeholder.style.display = 'flex'
                    placeholder.style.alignItems = 'center'
                    placeholder.style.justifyContent = 'center'
                    placeholder.style.color = '#9ca3af'
                    placeholder.style.fontSize = '14px'
                    placeholder.textContent = `Pagina ${pageNum}`

                    container.appendChild(placeholder)

                    // Render first 3 pages immediately
                    if (pageNum <= 3) {
                        await renderPage(pageNum, placeholder, containerWidth)
                        if (cancelled) return
                    }
                }

                // Set up IntersectionObserver for lazy loading remaining pages
                if (pdf.numPages > 3) {
                    const observer = new IntersectionObserver((entries) => {
                        entries.forEach(entry => {
                            if (entry.isIntersecting) {
                                const pageNum = parseInt(entry.target.getAttribute('data-page-num') || '0')
                                if (pageNum > 0) {
                                    renderPage(pageNum, entry.target as HTMLDivElement, containerWidth)
                                    observer.unobserve(entry.target)
                                }
                            }
                        })
                    }, { rootMargin: '200px' })

                    container.querySelectorAll('[data-page-num]').forEach(el => {
                        const num = parseInt(el.getAttribute('data-page-num') || '0')
                        if (num > 3) observer.observe(el)
                    })
                }

                setLoading(false)
            } catch (err: unknown) {
                if (!cancelled) {
                    console.error('[PdfViewer] Error rendering PDF:', err)
                    setError('Impossibile visualizzare il PDF')
                    setLoading(false)
                }
            }
        }

        loadPdf()
        return () => {
            cancelled = true
            pdfRef.current = null
            // eslint-disable-next-line react-hooks/exhaustive-deps
            renderedPagesRef.current.clear()
        }
    }, [url, clearContainer, renderPage])

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
