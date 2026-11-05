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

const NOTION_API_KEY = process.env.NOTION_API_KEY;
let NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// 32자리 ID 포맷팅 (하이픈 추가 처리)
if (NOTION_DATABASE_ID && NOTION_DATABASE_ID.length === 32 && !NOTION_DATABASE_ID.includes('-')) {
  NOTION_DATABASE_ID = `${NOTION_DATABASE_ID.slice(0, 8)}-${NOTION_DATABASE_ID.slice(8, 12)}-${NOTION_DATABASE_ID.slice(12, 16)}-${NOTION_DATABASE_ID.slice(16, 20)}-${NOTION_DATABASE_ID.slice(20)}`;
}

let notionClient = null;
if (NOTION_API_KEY) {
  notionClient = new Client({ auth: NOTION_API_KEY });
}

// 템플릿 검증 및 오프라인 테스트용 목(Mock) 지식 데이터
const MOCK_DOCUMENTS = [
  {
    id: "mock-doc-001",
    title: "신경계 약리학: 도파민 및 세로토닌 경로와 수용체 작용기전",
    tags: ["약리학", "신경계", "전공"],
    category: "임상약학",
    updatedAt: "2026-11-04T14:20:00.000Z",
    summary: "중추신경계(CNS)에서 도파민의 4대 신경 경로(흑질선조체, 중뇌변연계, 중뇌피질, 결절누두)와 5-HT 수용체 아형별 임상 의미 요약.",
    blocks: [
      {
        type: "callout",
        icon: "💡",
        text: "핵심 요약: 항정신병제 및 항우울제의 부작용(EPS, 고프로락틴혈증)은 도파민 경로 차단 위치에 따라 결정된다."
      },
      {
        type: "heading_1",
        text: "1. 도파민(Dopamine) 4대 신경 전달 경로"
      },
      {
        type: "paragraph",
        text: "도파민 신경로는 뇌의 기저핵과 변연계를 거치며 운동 조절, 보상 체계, 인지 기능 및 호르몬 분비에 관여합니다."
      },
      {
        type: "toggle",
        summary: "🔍 [셀프 테스트] 흑질선조체 경로(Nigrostriatal pathway)의 기능과 차단 시 부작용은?",
        children: [
          {
            type: "paragraph",
            text: "• 정상 기능: 추체외로계(EPS)를 통한 골격근 운동의 섬세한 조절.\n• D2 수용체 차단 시: 파킨슨 유사 증상, 급성 근긴장이상증, 정좌불능증, 지연성 운동이상증 발생."
          }
        ]
      },
      {
        type: "toggle",
        summary: "🔍 [셀프 테스트] 중뇌변연계(Mesolimbic) vs 중뇌피질(Mesocortical) 경로의 차이는?",
        children: [
          {
            type: "paragraph",
            text: "• 중뇌변연계(Mesolimbic): 과도한 도파민 신호 ➔ 환청, 망상 등 양성 증상(Positive symptoms) 유발.\n• 중뇌피질(Mesocortical): 도파민 신호 부족 ➔ 감정 둔마, 무의지증 등 음성 증상(Negative symptoms) 유발."
          }
        ]
      },
      {
        type: "heading_2",
        text: "2. 세로토닌(5-HT) 수용체 임상 중요 포인트"
      },
      {
        type: "bulleted_list_item",
        text: "5-HT1A: 체온 조절, 수면, 불안 조절 (Buspirone 부분 효능제 작용점)."
      },
      {
        type: "bulleted_list_item",
        text: "5-HT2A: 환각, 수면, 혈관 수축 (비정형 항정신병 약물의 주요 차단점)."
      },
      {
        type: "bulleted_list_item",
        text: "5-HT3: 유일한 이온통로 수용체 (Ondansetron 등 구토 조절 항구토제 표적)."
      }
    ]
  },
  {
    id: "mock-doc-002",
    title: "컴퓨터 시스템 아키텍처: 가상 메모리와 페이징(Paging) 기법",
    tags: ["CS", "운영체제", "시스템"],
    category: "컴퓨터과학",
    updatedAt: "2026-11-03T09:10:00.000Z",
    summary: "MMU를 통한 논리 주소의 물리 주소 변환 과정, 페이지 테이블(Page Table) 계층 구조 및 TLB 캐시 미스 처리.",
    blocks: [
      {
        type: "callout",
        icon: "⚡",
        text: "가상 메모리는 다중 프로그래밍 환경에서 각 프로세스에 독립적이고 광활한 주소 공간을 제공하는 핵심 추상화 계층입니다."
      },
      {
        type: "heading_1",
        text: "1. 가상 주소 변환(Address Translation) 메커니즘"
      },
      {
        type: "paragraph",
        text: "CPU가 생성하는 가상 주소는 페이지 번호(Page Number, p)와 오프셋(Offset, d)으로 분할됩니다. MMU의 TLB(Translation Lookaside Buffer)가 캐시 역할을 수행합니다."
      },
      {
        type: "toggle",
        summary: "🔍 [셀프 테스트] 페이지 폴트(Page Fault) 발생 시 OS의 5단계 처리 과정은?",
        children: [
          {
            type: "numbered_list_item",
            text: "1. CPU 트랩 발생 및 커널 모드 전환."
          },
          {
            type: "numbered_list_item",
            text: "2. 주소 유효성 검사 (유효하지 않은 접근 시 SIGSEGV 종료)."
          },
          {
            type: "numbered_list_item",
            text: "3. 스왑 영역(디스크)에서 빈 물리 프레임으로 페이지 읽기 요청."
          },
          {
            type: "numbered_list_item",
            text: "4. I/O 완료 인터럽트 수신 후 페이지 테이블 갱신 (유효 비트=1)."
          },
          {
            type: "numbered_list_item",
            text: "5. 트랩을 유발했던 원래 명령어부터 다시 재개."
          }
        ]
      }
    ]
  },
  {
    id: "mock-doc-003",
    title: "거시경제학 기초: 금리 인상 사이클과 환율·유동성 파급 경로",
    tags: ["경제", "거시경제", "상식"],
    category: "금융/경제",
    updatedAt: "2026-11-01T18:00:00.000Z",
    summary: "기준금리 변동이 은행 예대마진, 채권 수익률 곡선, 원/달러 환율 및 자산 시장 밸류에이션에 미치는 다차원 영향.",
    blocks: [
      {
        type: "heading_1",
        text: "1. 금리와 채권 가격의 역의 관계"
      },
      {
        type: "paragraph",
        text: "시장 금리가 상승하면 기존에 발행된 고정 이자 지급 채권의 매력도가 떨어지므로 채권 가격은 하락(듀레이션에 비례)합니다."
      },
      {
        type: "toggle",
        summary: "🔍 [셀프 테스트] 장단기 금리 역전 현상이 경기 침체(Recession) 신호인 이유는?",
        children: [
          {
            type: "paragraph",
            text: "중앙은행의 긴축으로 단기 금리가 급등하고, 시장 참여자들은 미래 경기 둔화를 예상하여 안전자산인 장기 채권으로 몰려 장기 금리가 하락하기 때문입니다."
          }
        ]
      }
    ]
  }
];

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
  if (!notionClient || !NOTION_DATABASE_ID) {
    console.log('[notion-reader] NOTION_API_KEY 미설정 ➔ 샘플 목(Mock) 데이터 목록 반환');
    return MOCK_DOCUMENTS.map(doc => ({
      id: doc.id,
      title: doc.title,
      tags: doc.tags,
      category: doc.category,
      updatedAt: doc.updatedAt,
      summary: doc.summary
    }));
  }

  // 캐시 검사
  const now = Date.now();
  if (!forceRefresh && documentsListCache.data && (now - documentsListCache.timestamp < DOCUMENTS_CACHE_TTL_MS)) {
    const remainingSec = Math.round((DOCUMENTS_CACHE_TTL_MS - (now - documentsListCache.timestamp)) / 1000);
    console.log(`[notion-cache] 문서 목록 캐시 히트 (총 ${documentsListCache.data.length}개, 잔여 TTL: ${remainingSec}초)`);
    return documentsListCache.data;
  }

  try {
    let targetDbId = NOTION_DATABASE_ID;

    // 만약 지정된 ID가 페이지라면 하위 인라인 데이터베이스 자동 탐색
    try {
      await withNotionRetry(
        () => notionClient.databases.retrieve({ database_id: targetDbId }),
        'databases.retrieve(probe)'
      );
    } catch (probeErr) {
      if (probeErr.message?.includes('is a page')) {
        console.log(`[notion-reader] 전달된 ID(${targetDbId})는 상위 페이지입니다. 하위 지식DB 탐색 중...`);
        const children = await withNotionRetry(
          () => notionClient.blocks.children.list({ block_id: targetDbId, page_size: 50 }),
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
        () => notionClient.databases.query({
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
      let category = "지식";
      for (const key of Object.keys(props)) {
        if (props[key].type === 'multi_select') {
          tags = props[key].multi_select.map(item => item.name);
        } else if (props[key].type === 'select' && props[key].select && !key.includes('상태')) {
          category = props[key].select.name;
        }
      }

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
    if (documentsListCache.data) {
      console.warn('[notion-cache] 노션 조회 실패로 인해 기존 캐시 목록 반환');
      return documentsListCache.data;
    }
    return MOCK_DOCUMENTS.map(doc => ({
      id: doc.id,
      title: doc.title,
      tags: doc.tags,
      category: doc.category,
      updatedAt: doc.updatedAt,
      summary: doc.summary
    }));
  }
}

// 2. 특정 문서 상세 본문(블록) 조회 (인메모리 Map 캐싱 + 수정 감지 안전장치)
async function getNotionDocumentDetail(documentId, forceRefresh = false) {
  // 목 데이터 확인
  const mock = MOCK_DOCUMENTS.find(d => d.id === documentId);
  if (mock && (!notionClient || !NOTION_DATABASE_ID)) {
    return mock;
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

  if (!notionClient) {
    return mock || { id: documentId, title: "문서를 찾을 수 없습니다", blocks: [] };
  }

  try {
    // 1) 페이지 정보 조회
    const page = await withNotionRetry(
      () => notionClient.pages.retrieve({ page_id: documentId }),
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
    return mock || { id: documentId, title: "문서 로딩 실패", blocks: [] };
  }
}

// 하위 블록(토글 내용 등) 재귀 조회 함수
async function fetchBlocksRecursively(blockId) {
  const blocks = [];
  let cursor = undefined;

  do {
    const { results, next_cursor, has_more } = await withNotionRetry(
      () => notionClient.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      }),
      `blocks.children.list(${blockId})`
    );

    for (const block of results) {
      const parsed = simplifyBlock(block);
      // 토글, 테이블, 콜아웃, 인용구, 중첩 리스트, 컬럼 등 하위 블록을 갖는 타입 재귀 탐색
      if (block.has_children && (block.type === 'toggle' || block.type === 'table' || block.type === 'callout' || block.type === 'quote' || block.type === 'column_list' || block.type === 'column' || block.type === 'bulleted_list_item' || block.type === 'numbered_list_item')) {
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
