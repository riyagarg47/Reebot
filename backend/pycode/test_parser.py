import re
import sys
from pathlib import Path


HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
LIST_RE = re.compile(r"^\s*(?:[-*+] |\d+\. )")
SENTENCE_RE = re.compile(
    r".*?[.!?。！？](?:[\"'”’)}\]]+)?(?=\s|$)|.+$",
    re.DOTALL,
)
SENTENCE_END_RE = re.compile(r"[.!?。！？](?:[\"'”’)}\]]+)?$")


BASE_DIR = Path(__file__).resolve().parent
MARKDOWN_PATH = BASE_DIR / "output.md"
CHUNKS_PATH = BASE_DIR / "chunks.md"
MAX_CHARS = 3000


def split_sections(markdown):
    sections = []
    heading_path = []
    current_path = []
    content = []

    def flush():
        body = "\n".join(content).strip()
        if body:
            sections.append((current_path.copy(), body))

    for line in markdown.splitlines():
        match = HEADING_RE.match(line)
        if not match:
            content.append(line)
            continue

        flush()
        content = []
        level = len(match.group(1))
        heading_path = heading_path[: level - 1]
        heading_path.append(line.strip())
        current_path = heading_path.copy()

    flush()
    return sections


def split_blocks(body):
    blocks = []
    current = []
    fence = None

    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            fence = None if fence == marker else marker
            current.append(line)
        elif not stripped and fence is None:
            if current:
                blocks.append("\n".join(current).strip())
                current = []
        else:
            current.append(line)

    if current:
        blocks.append("\n".join(current).strip())
    return blocks


def is_atomic_markdown(block):
    lines = block.splitlines()
    is_table = len(lines) > 1 and all(
        not line.strip() or line.lstrip().startswith("|") for line in lines
    )
    return (
        is_table
        or block.lstrip().startswith(("```", "~~~", "<!--", ">"))
        or bool(LIST_RE.match(block))
    )


def split_prose(block, max_chars):
    if len(block) <= max_chars or is_atomic_markdown(block):
        return [block]

    normalized = re.sub(r"\s+", " ", block).strip()
    sentences = [match.group(0).strip() for match in SENTENCE_RE.finditer(normalized)]
    if sentences and not SENTENCE_END_RE.search(sentences[-1]):
        sentences[-1] += "."

    pieces = []
    current = []
    for sentence in sentences:
        candidate = " ".join([*current, sentence])
        if current and len(candidate) > max_chars:
            pieces.append(" ".join(current))
            current = []
        current.append(sentence)
    if current:
        pieces.append(" ".join(current))
    return pieces or [block]


def render_chunk(heading_path, blocks):
    parts = [*heading_path, *blocks]
    return "\n\n".join(part for part in parts if part).strip()


def chunk_markdown(markdown, max_chars=MAX_CHARS):
    chunks = []
    for heading_path, body in split_sections(markdown):
        prefix_length = len("\n".join(heading_path))
        content_limit = max(200, max_chars - prefix_length - 2)
        current = []

        for block in split_blocks(body):
            for piece in split_prose(block, content_limit):
                candidate = render_chunk(heading_path, [*current, piece])
                if current and len(candidate) > max_chars:
                    chunks.append(render_chunk(heading_path, current))
                    current = []
                current.append(piece)

        if current:
            chunks.append(render_chunk(heading_path, current))
    return chunks


def render_chunks(chunks):
    rendered = []
    for index, chunk in enumerate(chunks, start=1):
        rendered.append(
            f"<!-- CHUNK {index} | {len(chunk)} chars -->\n\n{chunk}"
        )
    return "\n\n---\n\n".join(rendered) + "\n"


def main():
    if len(sys.argv) > 1:
        import pymupdf4llm

        pdf_path = Path(sys.argv[1]).resolve()
        if not pdf_path.exists():
            raise FileNotFoundError(pdf_path)
        markdown = pymupdf4llm.to_markdown(pdf_path)
        MARKDOWN_PATH.write_text(markdown, encoding="utf-8")
    else:
        markdown = MARKDOWN_PATH.read_text(encoding="utf-8")
        print(f"Using existing {MARKDOWN_PATH.name}")

    chunks = chunk_markdown(markdown)
    if not chunks:
        raise RuntimeError("Chunker produced no output.")

    for chunk in chunks:
        headings = [line for line in chunk.splitlines() if HEADING_RE.match(line)]
        if headings and not chunk.startswith(headings[0]):
            raise AssertionError("A chunk lost its heading context.")

    CHUNKS_PATH.write_text(render_chunks(chunks), encoding="utf-8")
    sizes = [len(chunk) for chunk in chunks]
    print(
        f"Saved {len(chunks)} chunks to {CHUNKS_PATH.name} "
        f"(min={min(sizes)}, max={max(sizes)}, avg={sum(sizes) // len(sizes)} chars)"
    )


if __name__ == "__main__":
    main()
