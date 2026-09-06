// app.post("/compare-pdf", upload.single("pdf"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "Upload a PDF." });
//     }

//     const buffer = req.file.buffer;
//     const [parsed, llm] = await Promise.allSettled([
//       textFromPdf(buffer),
//       textFromPdfUsingLLM(buffer),
//     ]);
//     const pdfParseChunks =
//       parsed.status === "fulfilled" ? chunkText(parsed.value) : [];
//     const llmChunks = llm.status === "fulfilled" ? chunkText(llm.value) : [];

//     res.json({
//       filename: req.file.originalname,
//       pdfParseChunks,
//       pdfParseError:
//         parsed.status === "rejected" ? parsed.reason.message : null,
//       llmChunks,
//       llmError: llm.status === "rejected" ? llm.reason.message : null,
//     });
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// export async function textFromPdfUsingLLM(buffer) {
//   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
//   const model = process.env.OPENAI_PDF_PARSE_MODEL || "gpt-5.6-luna";
//   const base64 = Buffer.from(buffer).toString("base64");

//   const response = await openai.responses.create({
//     model,
//     reasoning: { effort: "low" },
//     input: [
//       {
//         role: "user",
//         content: [
//           {
//             type: "input_file",
//             filename: "document.pdf",
//             file_data: `data:application/pdf;base64,${base64}`,
//             detail: "low",
//           },
//           {
//             type: "input_text",
//             text: "Parse this PDF into Markdown. Preserve headings, lists, tables, bold/italic, and reading order. Return Markdown only, no extra commentary.",
//           },
//         ],
//       },
//     ],
//   });

//   return (response.output_text || "").trim();
// }
