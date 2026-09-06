import json
import sys
from contextlib import redirect_stdout


def parse_pdf(pdf_bytes):
    """Extract Markdown from in-memory PDF bytes without writing any files."""

    # stdout is reserved for the JSON response consumed by Node.js.
    with redirect_stdout(sys.stderr):
        import pymupdf
        import pymupdf4llm

        document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            markdown = pymupdf4llm.to_markdown(document)
        finally:
            document.close()

    return markdown


def main():
    # Node sends the uploaded PDF through stdin to avoid temporary files.
    pdf_bytes = sys.stdin.buffer.read()
    if not pdf_bytes:
        raise ValueError("No PDF data received.")

    markdown = parse_pdf(pdf_bytes)
    if not markdown.strip():
        raise ValueError("No text found in the PDF.")

    # Keep stdout machine-readable: the Node bridge expects exactly one JSON object.
    json.dump({"markdown": markdown}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # A non-zero exit lets Node turn parser failures into API errors.
        print(str(error), file=sys.stderr)
        sys.exit(1)
