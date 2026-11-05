// 3단계 캐시 탐색 시뮬레이션
class MockCache {
  constructor() {
    this.store = new Map();
  }

  put(urlStr, responseData) {
    this.store.set(urlStr, responseData);
  }

  async match(request, options = {}) {
    const targetUrl = request.url;
    if (this.store.has(targetUrl)) {
      return this.store.get(targetUrl);
    }

    if (options.ignoreSearch) {
      const targetBase = targetUrl.split('?')[0];
      for (const [key, val] of this.store.entries()) {
        if (key.split('?')[0] === targetBase) {
          return val;
        }
      }
    }
    return null;
  }

  async keys() {
    return Array.from(this.store.keys()).map(url => ({ url }));
  }
}

async function findCachedImage(cache, request) {
  // 1단계: 정확한 요청 URL 매칭
  let match = await cache.match(request);
  if (match) return { match, stage: 1 };

  // 2단계: 쿼리 파라미터(?X-Amz-Signature=...)를 무시한 매칭
  match = await cache.match(request, { ignoreSearch: true });
  if (match) return { match, stage: 2 };

  // 3단계: 동일한 S3 파일 pathname 매칭 (Presigned URL 시그니처 갱신 대응)
  try {
    const reqUrl = new URL(request.url);
    const keys = await cache.keys();
    for (const key of keys) {
      const keyUrl = new URL(key.url);
      if (keyUrl.pathname === reqUrl.pathname) {
        const res = await cache.match(key);
        return { match: res, stage: 3 };
      }
    }
  } catch (e) {}

  return null;
}

async function runTest() {
  const cache = new MockCache();
  
  // 1. 처음 캐시된 이미지 URL (1시간 전 유효했던 S3 Presigned URL)
  const initialUrl = "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace123/block456/chemical_structure.png?X-Amz-Expires=3600&X-Amz-Signature=ORIGINAL_SIGNATURE";
  cache.put(initialUrl, "IMAGE_BINARY_BUFFER_PNG_DATA");

  // 2. 1시간 뒤 만료되어 새로 갱신된(또는 만료되어 403을 뱉는) 새 요청 URL
  const expiredOrNewUrl = "https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace123/block456/chemical_structure.png?X-Amz-Expires=3600&X-Amz-Signature=EXPIRED_OR_NEW_SIGNATURE";

  console.log("초기 캐시 URL:", initialUrl);
  console.log("만료 후 요청 URL:", expiredOrNewUrl);

  const found = await findCachedImage(cache, { url: expiredOrNewUrl });
  if (found && found.match === "IMAGE_BINARY_BUFFER_PNG_DATA") {
    console.log(`✅ [성공] 1시간 뒤 서명이 변경/만료된 S3 URL도 캐시 매칭 성공! (매칭 단계: ${found.stage}단계)`);
  } else {
    console.error("❌ [실패] 캐시를 찾지 못했습니다.");
  }
}

runTest();
