import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const parserPath = fileURLToPath(
  new URL("./pdf_parser.py", import.meta.url),
);

/**
 * Send PDF bytes to the Python extractor and resolve with its Markdown output.
 * Chunking intentionally happens in JavaScript after this function returns.
 */
export function parsePdf(buffer) {
  return new Promise((resolve, reject) => {
    // stdin carries the PDF; stdout is the JSON protocol; stderr contains
    // library logs and actionable parser errors.
    const child = spawn(process.env.PYTHON_BIN || "python3", [parserPath], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: Number(process.env.PDF_PARSE_TIMEOUT_MS) || 120_000,
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (data) => stdout.push(data));
    child.stderr.on("data", (data) => stderr.push(data));
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const errorOutput = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(errorOutput || "Python PDF parser failed."));
        return;
      }

      try {
        // Buffer all output because JSON may arrive across several data events.
        const result = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        if (typeof result.markdown !== "string") {
          throw new Error("Python PDF parser returned invalid output.");
        }
        resolve(result.markdown);
      } catch (error) {
        reject(new Error(`Could not read Python parser output: ${error.message}`));
      }
    });

    child.stdin.end(buffer);
  });
}
