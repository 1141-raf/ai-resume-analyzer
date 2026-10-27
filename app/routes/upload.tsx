import {type FormEvent, useState} from 'react'
import Navbar from "~/components/Navbar";
import FileUploader from "~/components/FileUploader";
import {usePuterStore} from "~/lib/puter";
import {useNavigate} from "react-router";
import {convertPdfToImage, extractPdfText} from "~/lib/pdf2img";
import {generateUUID} from "~/lib/utils";
import {prepareInstructions} from "../../constants";

const parseFeedback = (response: string): Feedback => {
    const text = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start < 0 || end <= start) {
            throw new Error('The AI returned an unreadable review. Please try again.');
        }
        try {
            parsed = JSON.parse(text.slice(start, end + 1));
        } catch {
            throw new Error('The AI returned an unreadable review. Please try again.');
        }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The AI returned an invalid review. Please try again.');
    }

    const feedback = parsed as Partial<Feedback>;
    const sections = [feedback.ATS, feedback.toneAndStyle, feedback.content, feedback.structure, feedback.skills];
    if (
        typeof feedback.overallScore !== 'number' ||
        sections.some((section) =>
            !section ||
            typeof section.score !== 'number' ||
            !Array.isArray(section.tips)
        )
    ) {
        throw new Error('The AI returned an incomplete review. Please try again.');
    }

    const categoryScores = sections.map((section) => section!.score);
    return {
        ...feedback,
        overallScore: Math.round(categoryScores.reduce((total, score) => total + score, 0) / categoryScores.length),
    } as Feedback;
};

const hasOnlyZeroScores = (feedback: Feedback): boolean =>
    [
        feedback.overallScore,
        feedback.ATS.score,
        feedback.toneAndStyle.score,
        feedback.content.score,
        feedback.structure.score,
        feedback.skills.score,
    ].every((score) => score === 0);

const Upload = () => {
    const { auth, isLoading, fs, ai, kv } = usePuterStore();
    const navigate = useNavigate();
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [errorText, setErrorText] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const handleFileSelect = (file: File | null) => {
        setFile(file)
    }

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }: { companyName: string, jobTitle: string, jobDescription: string, file: File  }) => {
        setIsProcessing(true);
        setErrorText('');
        const controller = new AbortController();
        let uploadedResumePath: string | undefined;
        let uploadedImagePath: string | undefined;

        try {
            setStatusText('Reading your resume and preparing its preview...');
            const [imageFile, resumeText] = await Promise.all([
                convertPdfToImage(file),
                extractPdfText(file),
            ]);
            if (resumeText.length < 80) {
                throw new Error('This PDF contains no readable text. Please upload a text-based PDF instead of a scanned image.');
            }
            if (!imageFile.file) throw new Error(imageFile.error || 'Could not create a preview of this PDF.');

            setStatusText('Uploading your resume and preview...');
            const [uploadedFile, uploadedImage] = await Promise.all([
                fs.upload([file]),
                fs.upload([imageFile.file]),
            ]);
            if (!uploadedFile) throw new Error('Could not upload your resume. Please try again.');
            uploadedResumePath = uploadedFile.path;
            if (!uploadedImage) throw new Error('Could not upload the resume preview. Please try again.');
            uploadedImagePath = uploadedImage.path;

            const uuid = generateUUID();
            const data = {
                id: uuid,
                resumePath: uploadedFile.path,
                imagePath: uploadedImage.path,
                companyName, jobTitle, jobDescription,
                feedback: '' as string | Feedback,
            };

            setStatusText('Analyzing your resume with Claude Sonnet 5.5...');
            const timeout = window.setTimeout(() => controller.abort(), 120_000);
            let feedbackText: string | undefined;
            let feedback: Feedback;
            try {
                feedbackText = await ai.feedback(
                    resumeText,
                    prepareInstructions({ jobTitle, jobDescription }),
                    controller.signal,
                    () => setStatusText('Writing your resume review...')
                );
                if (!feedbackText) throw new Error('The AI model returned an empty review.');

                try {
                    feedback = parseFeedback(feedbackText);
                } catch {
                    setStatusText('Formatting the review into a structured result...');
                    const retryText = await ai.feedback(
                        resumeText,
                        prepareInstructions({ jobTitle, jobDescription }),
                        controller.signal,
                        undefined,
                        false
                    );
                    if (!retryText) throw new Error('The AI model returned an empty review.');
                    feedback = parseFeedback(retryText);
                }

                if (hasOnlyZeroScores(feedback)) {
                    setStatusText('Checking whether the resume text was readable...');
                    const retryText = await ai.feedback(
                        resumeText,
                        `${prepareInstructions({ jobTitle, jobDescription })}\n\nThe previous result incorrectly assigned zero to every score. Read the attached resume itself and provide evidence-based scores from 1 to 100. If no resume text is readable, do not invent details.`,
                        controller.signal,
                        undefined,
                        false
                    );
                    if (!retryText) throw new Error('The AI model returned an empty review.');
                    feedback = parseFeedback(retryText);
                    if (hasOnlyZeroScores(feedback)) {
                        throw new Error('The AI could not read usable text from this PDF. Please upload a text-based PDF or export the resume again.');
                    }
                }
            } finally {
                window.clearTimeout(timeout);
            }
            data.feedback = feedback;
            const updated = await kv.set(`resume:${uuid}`, JSON.stringify(data));
            if (!updated) throw new Error('Your review was created but could not be saved. Please try again.');
            navigate(`/resume/${uuid}`);
        } catch (error) {
            await Promise.allSettled([
                uploadedResumePath ? fs.delete(uploadedResumePath) : Promise.resolve(),
                uploadedImagePath ? fs.delete(uploadedImagePath) : Promise.resolve(),
            ]);
            const message = error instanceof Error ? error.message : 'Something went wrong while analyzing your resume.';
            setErrorText(controller.signal.aborted ? 'Analysis timed out. Please try again.' : message);
            setIsProcessing(false);
        }
    }

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        const companyName = formData.get('company-name') as string;
        const jobTitle = formData.get('job-title') as string;
        const jobDescription = formData.get('job-description') as string;

        if (!file) {
            setErrorText('Choose a PDF resume before starting your analysis.');
            return;
        }

        void handleAnalyze({ companyName, jobTitle, jobDescription, file });
    }

    return (
        <main className="upload-page bg-[url('/images/bg-main.svg')] bg-cover">
            <Navbar />

            <section className="main-section upload-section">
                <div className="page-heading upload-heading py-12">
                    <p className="upload-eyebrow">RESUME REVIEW</p>
                    <h1>Make your next move count.</h1>
                    {isProcessing ? (
                        <>
                            <h2 role="status" aria-live="polite">{statusText}</h2>
                            <img src="/images/resume-scan.gif" alt="Analyzing your resume" className="w-full max-w-xl" />
                        </>
                    ) : (
                        <h2>Drop your resume for an ATS score and improvement tips</h2>
                    )}
                    {errorText && !isProcessing && (
                        <p role="alert" className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800">
                            {errorText}
                        </p>
                    )}
                    {!isProcessing && (
                        <form id="upload-form" onSubmit={handleSubmit} className="upload-form mt-4">
                            <div className="form-div">
                                <label htmlFor="company-name">Company Name</label>
                                <input type="text" name="company-name" placeholder="e.g. Acme Inc." id="company-name" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-title">Job Title</label>
                                <input type="text" name="job-title" placeholder="e.g. Product Designer" id="job-title" />
                            </div>
                            <div className="form-div upload-wide">
                                <label htmlFor="job-description">Job Description</label>
                                <textarea rows={4} name="job-description" placeholder="Paste the role description to tailor your feedback" id="job-description" />
                            </div>

                            <div className="form-div upload-wide">
                                <label htmlFor="uploader">Upload Resume</label>
                                <FileUploader file={file} onFileSelect={handleFileSelect} />
                            </div>

                            <button className="primary-button upload-wide disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!file}>
                                {file ? 'Analyze Resume' : 'Choose a PDF to continue'}
                            </button>
                        </form>
                    )}
                </div>
            </section>
        </main>
    )
}
export default Upload
