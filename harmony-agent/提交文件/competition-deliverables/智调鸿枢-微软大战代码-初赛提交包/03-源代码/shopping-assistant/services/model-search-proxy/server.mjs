import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..', '..');
const envPath = resolve(rootDir, '.env');
loadEnvFile(envPath);

const port = Number(process.env.MODEL_SEARCH_PROXY_PORT || '3010');
const provider = process.env.MODEL_SEARCH_PROVIDER || 'openai_compatible';
const baseUrl = stripTrailingSlash(process.env.MODEL_SEARCH_BASE_URL || process.env.CHAT_MODEL_BASE_URL || '');
const apiKey = process.env.MODEL_SEARCH_API_KEY || process.env.CHAT_MODEL_API_KEY || '';
const modelName = process.env.MODEL_SEARCH_MODEL || process.env.CHAT_MODEL_NAME || '';
const timeoutMs = Number(process.env.MODEL_SEARCH_TIMEOUT_MS || '12000');

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  if (request.url === '/api/model-search/chat') {
    try {
      const bodyText = await readRequestBody(request);
      const payload = JSON.parse(bodyText);
      const prompt = String(payload.prompt || '').trim();
      const context = String(payload.context || '');
      if (prompt.length === 0) {
        sendJson(response, 400, { ok: false, error: 'prompt is required' });
        return;
      }
      const result = await resolveChat(prompt, context);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, { ok: false, answer: '', error: error instanceof Error ? error.message : 'Unexpected error' });
    }
    return;
  }

  if (request.url !== '/api/model-search/text') {
    sendJson(response, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    const bodyText = await readRequestBody(request);
    const payload = JSON.parse(bodyText);
    const query = String(payload.query || '').trim();
    const limit = normalizeLimit(Number(payload.limit || '20'));

    if (query.length === 0) {
      sendJson(response, 400, { ok: false, error: 'query is required' });
      return;
    }

    const result = await resolveQueryWithModel(query, limit);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      source: 'proxy_error',
      error: error instanceof Error ? error.message : 'Unexpected proxy error'
    });
  }
});

server.listen(port, () => {
  console.log(`Model search proxy listening on http://127.0.0.1:${port}`);
  if (!apiKey || !baseUrl || !modelName) {
    console.log('Model provider is not fully configured. The proxy will use local keyword fallback.');
  } else {
    console.log(`Model provider: ${provider}, model: ${modelName}`);
  }
});

async function resolveQueryWithModel(query, limit) {
  if (!apiKey || !baseUrl || !modelName) {
    return localFallbackResult(query, limit, 'local_fallback_without_key');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: [
              '你是购物助手的本地检索规划器。',
              '请把用户自然语言转成适合本地商品库检索的短关键词。',
              '只返回 JSON，不要解释。字段：normalizedKeyword, keywords, intent, answerHint。',
              'keywords 最多 5 个，normalizedKeyword 不超过 12 个中文字符。'
            ].join('')
          },
          {
            role: 'user',
            content: `用户需求：${query}\n候选条数：${limit}`
          }
        ]
      })
    });

    if (!modelResponse.ok) {
      return localFallbackResult(query, limit, `model_http_${modelResponse.status}`);
    }

    const modelJson = await modelResponse.json();
    const content = String(modelJson?.choices?.[0]?.message?.content || '');
    const parsed = parseModelJson(content);
    const normalizedKeyword = normalizeKeyword(String(parsed.normalizedKeyword || ''));
    const keywords = normalizeKeywords(parsed.keywords);

    if (normalizedKeyword.length === 0) {
      return localFallbackResult(query, limit, 'model_empty_keyword');
    }

    return {
      ok: true,
      source: 'model',
      provider,
      query,
      normalizedKeyword,
      keywords,
      intent: String(parsed.intent || 'text_search'),
      answerHint: String(parsed.answerHint || ''),
      limit
    };
  } catch (error) {
    return localFallbackResult(query, limit, error instanceof Error ? error.message : 'model_request_failed');
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveChat(prompt, context) {
  if (!apiKey || !baseUrl || !modelName) {
    return { ok: false, answer: '', source: 'no_key' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemContent = [
    '你是一个智能购物助手，请根据用户的问题给出简洁、自然的中文回答（150字以内）。',
    context.length > 0 ? `当前检索到的商品参考：${context}` : ''
  ].filter(Boolean).join('\n');

  try {
    const modelResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.5,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!modelResponse.ok) {
      return { ok: false, answer: '', source: `model_http_${modelResponse.status}` };
    }

    const modelJson = await modelResponse.json();
    const answer = String(modelJson?.choices?.[0]?.message?.content || '').trim();
    return { ok: true, answer, source: 'model' };
  } catch (error) {
    return { ok: false, answer: '', source: error instanceof Error ? error.message : 'chat_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function localFallbackResult(query, limit, reason) {
  const normalizedKeyword = normalizeLocalKeyword(query);
  return {
    ok: true,
    source: 'fallback',
    provider,
    query,
    normalizedKeyword,
    keywords: normalizedKeyword.length > 0 ? [normalizedKeyword] : [],
    intent: 'text_search',
    answerHint: reason,
    limit
  };
}

function normalizeLocalKeyword(query) {
  const text = query.trim().toLowerCase();
  if (text.includes('电脑') || text.includes('笔记本') || text.includes('laptop') || text.includes('computer')) {
    return '电脑';
  }
  if (text.includes('耐克') || text.includes('nike')) {
    return '耐克';
  }
  if (text.includes('通勤') && (text.includes('男') || text.includes('鞋'))) {
    return '男鞋';
  }
  if (text.includes('运动') || text.includes('跑步')) {
    return '运动鞋';
  }
  if (text.includes('鞋')) {
    return '鞋';
  }
  return query.trim();
}

function parseModelJson(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(content);
  } catch (e) {
    return {};
  }
}

function normalizeKeyword(keyword) {
  return keyword.trim().slice(0, 24);
}

function normalizeKeywords(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeKeyword(String(item))).filter((item) => item.length > 0).slice(0, 5);
}

function normalizeLimit(limit) {
  if (!Number.isFinite(limit)) {
    return 20;
  }
  return Math.max(1, Math.min(50, Math.floor(limit)));
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        rejectBody(new Error('Request body too large'));
      }
    });
    request.on('end', () => resolveBody(body));
    request.on('error', rejectBody);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
