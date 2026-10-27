export interface PdfConversionResult {
    imageUrl: string;
    file: File | null;
    error?: string;
}

let pdfjsLib: any = null;
let loadPromise: Promise<any> | null = null;

async function loadPdfJs(): Promise<any> {
    if (pdfjsLib) return pdfjsLib;
    if (loadPromise) return loadPromise;

    // @ts-expect-error - pdfjs-dist/build/pdf.mjs is not a module
    loadPromise = import("pdfjs-dist/build/pdf.mjs")
        .then((lib) => {
            lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            pdfjsLib = lib;
            return lib;
        })
        .catch((error) => {
            loadPromise = null;
            throw error;
        });

    return loadPromise;
}

export async function extractPdfText(file: File): Promise<string> {
    const lib = await loadPdfJs();
    const data = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data }).promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
            .filter((item: { str?: unknown }) => typeof item.str === "string")
            .map((item: { str: string; hasEOL?: boolean }) => `${item.str}${item.hasEOL ? "\n" : " "}`)
            .join("");
        pageTexts.push(pageText);
    }

    return pageTexts.join("\n\n").replace(/[\t ]+/g, " ").trim();
}

export async function convertPdfToImage(
    file: File
): Promise<PdfConversionResult> {
    try {
        const lib = await loadPdfJs();

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
            2,
            1800 / Math.max(baseViewport.width, baseViewport.height)
        );
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
            return {
                imageUrl: "",
                file: null,
                error: "Your browser could not create a PDF preview",
            };
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        await page.render({ canvasContext: context, viewport }).promise;

        return new Promise((resolve) => {
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        // Create a File from the blob with the same name as the pdf
                        const originalName = file.name.replace(/\.pdf$/i, "");
                        const imageFile = new File([blob], `${originalName}.jpg`, {
                            type: "image/jpeg",
                        });

                        resolve({
                            imageUrl: URL.createObjectURL(blob),
                            file: imageFile,
                        });
                    } else {
                        resolve({
                            imageUrl: "",
                            file: null,
                            error: "Failed to create image blob",
                        });
                    }
                },
                "image/jpeg",
                0.88
            ); // Set quality to maximum (1.0)
        });
    } catch (err) {
        return {
            imageUrl: "",
            file: null,
            error: `Failed to convert PDF: ${err}`,
        };
    }
}
