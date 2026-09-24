# SoleAI image search diagnostics

This is a local-only diagnostic page for tuning image search quality. It does
not change the Flutter app or the production user flow.

## What it shows

- Uploaded query image and created `assetId`
- Official image session result from `/api/v1/sessions`
- Candidate list from `/api/v1/sessions/{sessionId}/candidates`
- Optional refined result from `/api/v1/sessions/{sessionId}/turns`
- Optional manual bbox rerun through `/api/v1/sessions/{sessionId}/subject-selection`
- ANN embedding diagnostic result from `/api/v1/product-pool/ann/diagnose`
- Product images, embedding metadata, normalized tags, tag audits, and visual verification raw payload

## How to use

1. Start the API server from the repo root:

   ```powershell
   npm --workspace services/api-server run start
   ```

2. Open `tools/image-search-diagnostics/index.html` in a browser.

3. Set `API Base URL`, usually:

   ```text
   http://127.0.0.1:3000
   ```

4. Paste `MAINTENANCE_API_TOKEN` from `.env` if you want ANN diagnose output.
   Without this token, the page still runs the normal image session flow.

5. Upload an image and adjust:

   - `ANN topK`
   - `ANN minScore`
   - `Embedding text hint`
   - Optional natural-language refine text
   - Optional normalized bbox

6. Click `运行诊断`.

## Reading the result

- `ANN Embedding 近邻结果` shows direct vector-search neighbors.
- `正式融合候选结果` shows the real app pipeline after tag recall, ANN recall, fusion, ranking, and visual verification.
- For each product card, open `原始诊断数据` to inspect:
  - `annScore`
  - `tagMatchScore`
  - `finalScore`
  - `visualVerification`
  - product embeddings
  - tag audit consensus

Use this page to decide whether search inaccuracy comes from image embedding,
tag filtering, fusion ranking, bbox crop, or visual verification.
