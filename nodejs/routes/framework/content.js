const express = require('express');
const { randomUUID } = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { pool, minioClient, upload, BUCKET } = require('../../db');
const { getUserSecret } = require('../../lib/secrets');

const router = express.Router();

// Runs BEFORE multer so non-admin clients are rejected before the server
// buffers any multipart body into memory.
const requireAdmin = (req, res, next) =>
  req.user?.tier === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' });

const GENERATE_SYSTEM_PROMPT = `You are a CMS content formatter. You receive LaTeX documents and reformat them faithfully into structured content components for a website.

Available component types:
- "contentHtml":      { "html": "..." } — semantic HTML, no math.
- "contentLatex":     { "html": "..." } — semantic HTML that may contain KaTeX math delimiters ($...$, $$...$$). Use for any section containing equations.
- "contentImage":     { "src": "<URL>" } — standalone image with no accompanying text.
- "contentHtmlImage": { "html": "<p>Caption or description</p>", "src": "<URL>" } — image paired with its caption/description text.

Output each content node as a JSON object followed immediately by the sentinel <<<END>>> on its own line.
After all nodes, output a final block with just { "_done": true, "message": "Short description" } followed by <<<END>>>.

Example format:
{ "name": "introduction", "type": "contentHtml", "data": { "html": "<h2>Introduction</h2><p>...</p>" }, "options": {} }
<<<END>>>
{ "name": "methods", "type": "contentLatex", "data": { "html": "<h2>Methods</h2><p>The equation $E=mc^2$ ...</p>" }, "options": {} }
<<<END>>>
{ "_done": true, "message": "Generated 2 nodes" }
<<<END>>>

Rules for the output format:
- Output ONLY the JSON blocks and <<<END>>> sentinels. No markdown, no other text.
- Each JSON block must be valid JSON. Escape any special characters inside string values (newlines as \\n, quotes as \\").
- Write the full content of each section in its JSON block before outputting <<<END>>>.

Content rules — apply to every node:
- REPRODUCE ALL TEXT FAITHFULLY. Do not summarise, shorten, paraphrase, or omit any sentence, clause, or detail.
- Strip LaTeX structure/layout commands (\\documentclass, \\usepackage, \\begin{document}, \\maketitle, \\multicols, \\flushbottom, \\thispagestyle, comments starting with %).
- \\section{X} → <h2>X</h2>, \\subsection{X} → <h3>X</h3>, \\subsubsection{X} → <h4>X</h4>, \\paragraph{X} → <h4>X</h4>.
- \\textbf{X} → <strong>X</strong>, \\textit{X} or \\emph{X} → <em>X</em>.
- \\begin{itemize}...\\item → <ul><li>...</li></ul>. \\begin{enumerate}...\\item → <ol><li>...</li></ol>.
- \\begin{table}...\\end{table} → a proper HTML <table> with <thead>/<tbody>. Preserve all cell content exactly.
- \\cite{key} → leave as the literal string \cite{key}. Do NOT convert to superscript or any other format. These will be linked to the bibliography later.
- \\gls{X} or \\glspl{X} → the abbreviation as plain text (e.g. \\gls{CVS} → CVS).
- \\label{}, \\ref{}, \\eqref{} → keep as plain text reference e.g. "(Eq. 1)" where appropriate, or omit if purely structural.
- Title/authors/affiliations/abstract: render as a single "contentHtml" node named "header" with the title in <h1>, authors as <p>, affiliations as <p>, abstract heading as <h2>, abstract text as <p>.

Math rules:
- Inline math \\(...\\) or $...$ → keep as $...$ (KaTeX inline).
- Display math \\[...\\], $$...$$, \\begin{equation}...\\end{equation}, \\begin{align}...\\end{align}, and all other math environments → wrap content as $$...$$ (KaTeX display). Preserve the inner LaTeX exactly.
- Never convert math to plain text or Unicode approximations. Always use a contentLatex node for sections containing math.

Image rules:
- Each \\includegraphics{filename} maps to a URL provided in the message. Use the exact URL.
- If the figure has a \\caption{...}, use contentHtmlImage with the caption text in "html" and the URL in "src".
- If no caption, use contentImage.

Splitting rules:
- One node per \\section{}. Subsections stay inside their parent section node unless the section is very long, in which case split per \\subsection{}.
- Do not merge sections. Do not drop any section.
- "name" must be snake_case, unique, and descriptive (e.g. "introduction", "methods_egd_framework").

Refinement turns:
- When the user asks to change something, output a complete updated node list incorporating the change. Preserve all other nodes exactly.`;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

router.post('/generate-content', requireAdmin, upload.array('files', 50), async (req, res) => {
  // Backoffice Content-page feature — admin only.
  if (req.user?.tier !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const files    = req.files ?? [];
  const history  = JSON.parse(req.body.history ?? '[]');
  const userText = (req.body.userText ?? '').trim();

  // The key never travels from the client — it is decrypted from the caller's keychain.
  let apiKey;
  try {
    apiKey = await getUserSecret(req.user.id, 'anthropic_api_key');
  } catch (e) {
    console.error('-> Keychain error:', e.message);
    return res.status(500).json({ error: e.message });
  }
  if (!apiKey) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'No Anthropic API key set. Add one in Account → Integrations.' });
  }

  // 30-minute timeout — generation can take 20+ min for large documents
  const anthropic = new Anthropic.default({ apiKey, timeout: 30 * 60 * 1000 });

  try {
    let userMessage = userText;
    let userSummary = userText || 'Generate content';

    if (files.length > 0) {
      const texFile    = files.find(f => f.originalname.endsWith('.tex'));
      const imageFiles = files.filter(f => IMAGE_MIMES.has(f.mimetype));

      const urlMap = {};
      for (const img of imageFiles) {
        const safeFilename = img.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${randomUUID()}-${safeFilename}`;
        await minioClient.putObject(BUCKET, key, img.buffer, img.size, { 'Content-Type': img.mimetype });
        try {
          await pool.query(
            `INSERT INTO files (bucket, key, filename, mime_type, size, description, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [BUCKET, key, img.originalname, img.mimetype, img.size, 'Generated content image', req.user.id]
          );
        } catch (dbErr) {
          console.error('Generate content: failed to record image in DB:', dbErr.message);
        }
        const base = process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.NODE_PORT}`;
        const downloadUrl = `${base}/api/files/${encodeURIComponent(key)}/download-by-key`;
        urlMap[img.originalname] = downloadUrl;
      }

      const parts = [];
      const summaryParts = [];
      if (texFile) {
        parts.push(`LaTeX document:\n\`\`\`\n${texFile.buffer.toString('utf-8')}\n\`\`\``);
        summaryParts.push(texFile.originalname);
      }
      if (Object.keys(urlMap).length > 0) {
        parts.push(`Image filename → URL map:\n${JSON.stringify(urlMap, null, 2)}`);
        summaryParts.push(`${imageFiles.length} image${imageFiles.length !== 1 ? 's' : ''}`);
      }
      if (userText) { parts.push(userText); summaryParts.push(`"${userText}"`); }
      userMessage = parts.join('\n\n');
      userSummary = summaryParts.join(' + ');
    }

    if (!userMessage) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'No content provided' });
    }

    const messages = [...history, { role: 'user', content: userMessage }];

    req.socket.setTimeout(0);
    req.setTimeout(0);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    const stream = anthropic.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 32000,
      system:     GENERATE_SYSTEM_PROMPT,
      messages,
    });

    const nodes = [];
    let blockBuffer = '';
    let doneMessage = '';

    const parseBlock = (block) => {
      const trimmed = block.trim();
      if (!trimmed) return;
      try {
        const obj = JSON.parse(trimmed);
        if (obj._done) {
          doneMessage = obj.message ?? '';
        } else {
          nodes.push(obj);
          send({ type: 'node', node: obj });
        }
      } catch (e) {
        console.error('Generate content: failed to parse block:', trimmed.slice(0, 200), e.message);
      }
    };

    stream.on('text', (text) => {
      send({ type: 'delta', text });
      blockBuffer += text;
      const parts = blockBuffer.split('<<<END>>>');
      blockBuffer = parts.pop();
      parts.forEach(parseBlock);
    });

    await stream.finalMessage();
    if (blockBuffer.trim()) parseBlock(blockBuffer);

    if (nodes.length === 0 && !doneMessage) {
      send({ type: 'error', error: 'Model returned no content. Try again.' });
      return res.end();
    }

    const assistantRaw = JSON.stringify({ message: doneMessage, nodes });
    send({ type: 'done', userMessage, userSummary, assistantRaw, message: doneMessage, nodes });
    res.end();
  } catch (e) {
    console.error('Generate content error:', e.message);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
      res.end();
    } catch (_) {}
  }
});

module.exports = router;
