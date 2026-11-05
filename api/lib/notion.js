// api/lib/notion.js - 노션 읽기 전용 클라이언트 및 목(Mock) 데이터 폴백
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// .env 자동 로드 (독립 실행 대응)
function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

let notionClient = null;

function getNotionClient() {
  if (notionClient) return notionClient;
  loadEnv();
  const apiKey = process.env.NOTION_API_KEY;
  if (apiKey) {
    notionClient = new Client({ auth: apiKey });
  }
  return notionClient;
}

function getDatabaseId() {
  loadEnv();
  let dbId = process.env.NOTION_DATABASE_ID || '16015410-8ad6-8031-9e4d-fe61caec185c';
  if (dbId && dbId.length === 32 && !dbId.includes('-')) {
    dbId = `${dbId.slice(0, 8)}-${dbId.slice(8, 12)}-${dbId.slice(12, 16)}-${dbId.slice(16, 20)}-${dbId.slice(20)}`;
  }
  return dbId;
}

// --- 인메모리 캐싱 레이어 설정 (TTL 20분 & 노션 429 방어) ---
const DOCUMENTS_CACHE_TTL_MS = 20 * 60 * 1000; // 20분
const DETAIL_CACHE_TTL_MS = 20 * 60 * 1000;    // 20분
const MAX_DETAIL_CACHE_SIZE = 300;             // 최대 300개 상세 문서 보관 (메모리 누수 방지)

let documentsListCache = {
  data: null,
  timestamp: 0
};

const documentDetailCache = new Map();

function clearNotionCache() {
  documentsListCache = { data: null, timestamp: 0 };
  documentDetailCache.clear();
  console.log('[notion-cache] 전체 인메모리 캐시가 초기화되었습니다.');
}

function getCacheStats() {
  const now = Date.now();
  const listAgeMs = documentsListCache.timestamp ? (now - documentsListCache.timestamp) : null;
  return {
    listCached: !!documentsListCache.data,
    listCount: documentsListCache.data?.length || 0,
    listAgeSeconds: listAgeMs ? Math.round(listAgeMs / 1000) : null,
    listTtlRemainingSeconds: listAgeMs ? Math.max(0, Math.round((DOCUMENTS_CACHE_TTL_MS - listAgeMs) / 1000)) : 0,
    detailCacheSize: documentDetailCache.size
  };
}

// 429 및 일시적 서버 오류 대응 지수 백오프 래퍼
async function withNotionRetry(apiCallFn, operationName = 'Notion API') {
  const maxRetries = 3;
  let attempt = 0;
  while (true) {
    try {
      return await apiCallFn();
    } catch (err) {
      attempt++;
      const status = err.status || err.code;
      const isRateLimit = status === 429 || (err.message && err.message.includes('rate limit'));
      const isServerError = typeof status === 'number' && status >= 500 && status < 600;

      if (attempt <= maxRetries && (isRateLimit || isServerError)) {
        let delayMs = 1500 * Math.pow(2, attempt - 1);
        if (err.headers && typeof err.headers.get === 'function') {
          const retryAfter = err.headers.get('retry-after');
          if (retryAfter) {
            const parsed = parseInt(retryAfter, 10);
            if (!isNaN(parsed) && parsed > 0) {
              delayMs = parsed * 1000;
            }
          }
        }
        console.warn(`[notion-rate-limit] ${operationName} 일시 오류(${status}), ${delayMs}ms 대기 후 재시도 (${attempt}/${maxRetries})...`);
        await new Promise(res => setTimeout(res, delayMs));
        continue;
      }
      throw err;
    }
  }
}

// 1. 노션 DB 문서 목록 조회 (전체 페이징 수집 및 인메모리 캐시)
async function getNotionDocuments(forceRefresh = false) {
  const client = getNotionClient();
  const dbId = getDatabaseId();

  if (!client) {
    throw new Error('NOTION_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인해주세요.');
  }

  // 캐시 검사
  const now = Date.now();
  if (!forceRefresh && documentsListCache.data && (now - documentsListCache.timestamp < DOCUMENTS_CACHE_TTL_MS)) {
    const remainingSec = Math.round((DOCUMENTS_CACHE_TTL_MS - (now - documentsListCache.timestamp)) / 1000);
    console.log(`[notion-cache] 문서 목록 캐시 히트 (총 ${documentsListCache.data.length}개, 잔여 TTL: ${remainingSec}초)`);
    return documentsListCache.data;
  }

  try {
    let targetDbId = dbId;

    // 만약 지정된 ID가 페이지라면 하위 인라인 데이터베이스 자동 탐색
    try {
      await withNotionRetry(
        () => client.databases.retrieve({ database_id: targetDbId }),
        'databases.retrieve(probe)'
      );
    } catch (probeErr) {
      if (probeErr.message?.includes('is a page')) {
        console.log(`[notion-reader] 전달된 ID(${targetDbId})는 상위 페이지입니다. 하위 지식DB 탐색 중...`);
        const children = await withNotionRetry(
          () => client.blocks.children.list({ block_id: targetDbId, page_size: 50 }),
          'blocks.children.list(probeDb)'
        );
        const childDb = children.results.find(b => b.type === 'child_database');
        if (childDb) {
          targetDbId = childDb.id;
          console.log(`[notion-reader] 하위 인라인 DB 발견: ${childDb.child_database.title} (${targetDbId})`);
        }
      }
    }

    // 전체 페이징 조회 (100건 제한 해제)
    const allResults = [];
    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await withNotionRetry(
        () => client.databases.query({
          database_id: targetDbId,
          sorts: [
            {
              timestamp: 'last_edited_time',
              direction: 'descending'
            }
          ],
          start_cursor: cursor,
          page_size: 100
        }),
        'databases.query'
      );

      allResults.push(...response.results);
      hasMore = response.has_more;
      cursor = response.next_cursor;
    }

    console.log(`[notion-reader] 노션 DB 총 ${allResults.length}개 문서 수집 완료`);

    const parsedDocs = allResults.map(page => {
      // 페이지 제목 추출
      let title = "제목 없음";
      const props = page.properties;
      for (const key of Object.keys(props)) {
        if (props[key].type === 'title' && props[key].title?.length > 0) {
          title = props[key].title.map(t => t.plain_text).join('');
          break;
        }
      }

      // 상태(Status) 속성 추출
      let status = "시작 전";
      let statusColor = "default";
      for (const key of Object.keys(props)) {
        if (props[key].type === 'status' && props[key].status) {
          status = props[key].status.name;
          statusColor = props[key].status.color || 'default';
          break;
        } else if (props[key].type === 'select' && props[key].select && (key.includes('상태') || key.toLowerCase().includes('status'))) {
          status = props[key].select.name;
          statusColor = props[key].select.color || 'default';
          break;
        }
      }

      // 태그 / 다중 선택 속성 추출
      let tags = [];
      let category = "";
      for (const key of Object.keys(props)) {
        if (props[key].type === 'multi_select') {
          tags = props[key].multi_select.map(item => item.name);
        } else if (props[key].type === 'select' && props[key].select && !key.includes('상태')) {
          category = props[key].select.name;
        }
      }

      // 별도 단일 select 카테고리 컬럼이 없을 경우, 태그에서 주 임상 분과(소화기, 신경정신, 영양건기 등)를 카테고리로 채택
      if (!category && tags.length > 0) {
        const specialty = tags.find(t => !['약물', '주의부작용', 'DDI', '사용법', '미용', '만성'].includes(t))
                       || tags.find(t => t !== '약물')
                       || tags[0];
        if (specialty) category = specialty;
      }
      if (!category) category = "임상약학";

      return {
        id: page.id,
        title,
        tags,
        category,
        status,
        statusColor,
        createdAt: page.created_time,
        updatedAt: page.last_edited_time,
        url: page.url
      };
    });

    // 목록 캐시 갱신
    documentsListCache = {
      data: parsedDocs,
      timestamp: Date.now()
    };

    return parsedDocs;
  } catch (error) {
    console.error('[notion-reader] 노션 DB 조회 실패:', error.message);
    if (documentsListCache.data && documentsListCache.data.length > 0) {
      console.warn('[notion-cache] 노션 조회 실패로 인해 기존 캐시 목록 반환');
      return documentsListCache.data;
    }
    throw error;
  }
}

// 2. 특정 문서 상세 본문(블록) 조회 (인메모리 Map 캐싱 + 수정 감지 안전장치)
async function getNotionDocumentDetail(documentId, forceRefresh = false) {
  const client = getNotionClient();
  if (!client) {
    throw new Error('NOTION_API_KEY가 설정되지 않았습니다.');
  }

  // 1) 인메모리 상세 캐시 검사
  const cached = documentDetailCache.get(documentId);
  const now = Date.now();
  if (cached && !forceRefresh) {
    const isExpired = (now - cached.timestamp) >= DETAIL_CACHE_TTL_MS;

    // 새 글/수정 반영을 위한 안전장치:
    // 목록 캐시에 최신 updatedAt이 있다면 캐시된 상세의 updatedAt과 대조하여 최신화
    let isStaleFromUpdate = false;
    if (documentsListCache.data) {
      const listDoc = documentsListCache.data.find(d => d.id === documentId);
      if (listDoc && listDoc.updatedAt && cached.updatedAt) {
        if (new Date(listDoc.updatedAt).getTime() > new Date(cached.updatedAt).getTime()) {
          isStaleFromUpdate = true;
          console.log(`[notion-cache] 문서(${documentId}) 노션 최신 수정 감지 -> 캐시 무효화 및 재조회`);
        }
      }
    }

    if (!isExpired && !isStaleFromUpdate) {
      const remainingSec = Math.round((DETAIL_CACHE_TTL_MS - (now - cached.timestamp)) / 1000);
      console.log(`[notion-cache] 문서(${documentId}) 상세 캐시 히트 (즉시 반환, 잔여 TTL: ${remainingSec}초)`);
      return cached.data;
    }
  }

  try {
    // 1) 페이지 정보 조회
    const page = await withNotionRetry(
      () => client.pages.retrieve({ page_id: documentId }),
      `pages.retrieve(${documentId})`
    );
    let title = "제목 없음";
    const props = page.properties;
    for (const key of Object.keys(props)) {
      if (props[key].type === 'title' && props[key].title?.length > 0) {
        title = props[key].title.map(t => t.plain_text).join('');
        break;
      }
    }

    // 2) 블록(본문) 재귀 조회
    const blocks = await fetchBlocksRecursively(documentId);

    const docDetail = {
      id: page.id,
      title,
      updatedAt: page.last_edited_time,
      blocks
    };

    // 캐시 저장 (LRU 방어: 최대 항목 초과 시 가장 오래된 항목 제거)
    if (documentDetailCache.size >= MAX_DETAIL_CACHE_SIZE) {
      const oldestKey = documentDetailCache.keys().next().value;
      documentDetailCache.delete(oldestKey);
    }
    documentDetailCache.set(documentId, {
      data: docDetail,
      timestamp: Date.now(),
      updatedAt: page.last_edited_time
    });

    return docDetail;
  } catch (error) {
    console.error(`[notion-reader] 문서(${documentId}) 조회 실패:`, error.message);
    if (cached && cached.data) {
      console.warn(`[notion-cache] 문서(${documentId}) 조회 실패로 인해 이전 캐시 데이터 반환`);
      return cached.data;
    }
    throw error;
  }
}

// 하위 블록(토글 내용 등) 재귀 조회 함수
async function fetchBlocksRecursively(blockId) {
  const blocks = [];
  let cursor = undefined;

  do {
    const client = getNotionClient();
    const { results, next_cursor, has_more } = await withNotionRetry(
      () => client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      }),
      `blocks.children.list(${blockId})`
    );

    for (const block of results) {
      const parsed = simplifyBlock(block);
      // 토글, 테이블, 콜아웃, 인용구, 중첩 리스트, 컬럼, 코드 등 하위 자식을 갖는 모든 블록 재귀 탐색
      if (block.has_children && block.type !== 'child_page' && block.type !== 'child_database') {
        parsed.children = await fetchBlocksRecursively(block.id);
      }
      blocks.push(parsed);
    }

    cursor = has_more ? next_cursor : undefined;
  } while (cursor);

  return blocks;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 노션 서식 및 글자/배경 색상 HTML 변환기
function renderRichText(richTextArray) {
  if (!richTextArray || richTextArray.length === 0) return '';
  return richTextArray.map(item => {
    let text = escapeHtml(item.plain_text || '');
    if (!text) return '';

    const ann = item.annotations || {};

    // 1. 인라인 코드
    if (ann.code) text = `<code>${text}</code>`;
    // 2. 굵게
    if (ann.bold) text = `<strong>${text}</strong>`;
    // 3. 기울임
    if (ann.italic) text = `<em>${text}</em>`;
    // 4. 취소선
    if (ann.strikethrough) text = `<s>${text}</s>`;
    // 5. 밑줄
    if (ann.underline) text = `<u>${text}</u>`;

    // 6. 노션 글자색 및 배경 하이라이트 색상 반영
    if (ann.color && ann.color !== 'default') {
      text = `<span class="notion-color-${ann.color}">${text}</span>`;
    }

    // 7. 하이퍼링크
    if (item.href) {
      text = `<a href="${item.href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }

    return text;
  }).join('');
}

// 노션 복잡한 블록 객체를 초경량 JSON 및 서식 보존 HTML로 단순화
function simplifyBlock(block) {
  const type = block.type;
  const content = block[type];
  let text = "";
  let html = "";

  if (content && content.rich_text) {
    text = content.rich_text.map(t => t.plain_text).join('');
    html = renderRichText(content.rich_text);
  }

  const result = {
    id: block.id,
    type,
    text,
    html: html || escapeHtml(text)
  };

  if (type === 'callout') {
    result.icon = content.icon?.emoji || "📌";
  } else if (type === 'code') {
    result.language = content.language || 'plain text';
    result.code = text;
    result.html = escapeHtml(text);
  } else if (type.startsWith('heading_')) {
    result.isToggleable = content.is_toggleable || false;
  } else if (type === 'toggle') {
    result.summary = text || "열기 / 닫기";
    result.summaryHtml = html || escapeHtml(text) || "열기 / 닫기";
  } else if (type === 'image') {
    result.imageUrl = content.type === 'external' ? content.external.url : content.file.url;
  } else if (type === 'to_do') {
    result.checked = content.checked;
  } else if (type === 'table') {
    result.tableWidth = content.table_width;
    result.hasColumnHeader = content.has_column_header;
    result.hasRowHeader = content.has_row_header;
  } else if (type === 'table_row') {
    result.cells = (content.cells || []).map(cellRichTexts => ({
      text: cellRichTexts.map(t => t.plain_text).join(''),
      html: renderRichText(cellRichTexts)
    }));
  }

  return result;
}

module.exports = {
  getNotionDocuments,
  getNotionDocumentDetail,
  clearNotionCache,
  getCacheStats
};
