import json
import sys
from contextlib import redirect_stdout


def parse_pdf(pdf_bytes):
    """Extract page-aware Markdown without writing the uploaded PDF to disk."""

    # stdout is reserved for the JSON response consumed by Node.js.
    with redirect_stdout(sys.stderr):
        import pymupdf
        import pymupdf4llm

        document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            pages = [
                {
                    "pageNumber": page_number + 1,
                    "markdown": pymupdf4llm.to_markdown(
                        document, pages=[page_number]
                    ),
                }
                for page_number in range(document.page_count)
            ]
        finally:
            document.close()

    return [page for page in pages if page["markdown"].strip()]


def main():
    # Node sends the uploaded PDF through stdin to avoid temporary files.
    pdf_bytes = sys.stdin.buffer.read()
    if not pdf_bytes:
        raise ValueError("No PDF data received.")

    pages = parse_pdf(pdf_bytes)
    if not pages:
        raise ValueError("No text found in the PDF.")

    # Keep stdout machine-readable: the Node bridge expects exactly one JSON object.
    json.dump({"pages": pages}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # A non-zero exit lets Node turn parser failures into API errors.
        print(str(error), file=sys.stderr)
        sys.exit(1)
