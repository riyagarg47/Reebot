import json
import re
import sys
from difflib import SequenceMatcher


def tokens(value):
    return re.findall(r"[\w]+", value.lower(), flags=re.UNICODE)


def render(pdf_bytes, page_number, chunk_text):
    import pymupdf

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = document[page_number - 1]
        words = page.get_text("words", sort=True)

        page_tokens = []
        token_words = []
        for word in words:
            for token in tokens(word[4]):
                page_tokens.append(token)
                token_words.append(word)

        matched_words = set()
        matcher = SequenceMatcher(None, page_tokens, tokens(chunk_text), autojunk=False)
        for block in matcher.get_matching_blocks():
            if block.size < 2:
                continue
            matched_words.update(range(block.a, block.a + block.size))

        highlight_rects = []
        seen_rects = set()
        for index in matched_words:
            word = token_words[index]
            rect_key = tuple(word[:4])
            if rect_key in seen_rects:
                continue
            seen_rects.add(rect_key)
            rect = pymupdf.Rect(*rect_key)
            highlight_rects.append(rect)
            page.add_highlight_annot(rect)

        clip = page.rect
        if highlight_rects:
            focus = pymupdf.Rect(highlight_rects[0])
            for rect in highlight_rects[1:]:
                focus.include_rect(rect)

            matched_lines = {
                (token_words[index][5], token_words[index][6])
                for index in matched_words
            }
            line_rects = [
                pymupdf.Rect(*word[:4])
                for word in words
                if (word[5], word[6]) in matched_lines
            ]
            horizontal_focus = pymupdf.Rect(line_rects[0])
            for rect in line_rects[1:]:
                horizontal_focus.include_rect(rect)

            # Preserve nearby context, but do not shrink the text with unused page space.
            padding_x = 45
            padding_y = 55
            min_width = min(360, page.rect.width)
            x0 = max(page.rect.x0, horizontal_focus.x0 - padding_x)
            x1 = min(page.rect.x1, horizontal_focus.x1 + padding_x)
            if x1 - x0 < min_width:
                center = (x0 + x1) / 2
                x0 = max(page.rect.x0, center - min_width / 2)
                x1 = min(page.rect.x1, x0 + min_width)
                x0 = max(page.rect.x0, x1 - min_width)

            clip = pymupdf.Rect(
                x0,
                max(page.rect.y0, focus.y0 - padding_y),
                x1,
                min(page.rect.y1, focus.y1 + padding_y),
            )

        pixmap = page.get_pixmap(
            matrix=pymupdf.Matrix(2, 2),
            clip=clip,
            alpha=False,
        )
        return pixmap.tobytes("png")
    finally:
        document.close()


def main():
    request = json.loads(sys.stdin.buffer.readline())
    pdf_bytes = sys.stdin.buffer.read()
    if not pdf_bytes:
        raise ValueError("No PDF data received.")

    image = render(
        pdf_bytes,
        int(request["pageNumber"]),
        request["text"],
    )
    sys.stdout.buffer.write(image)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
