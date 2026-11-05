const testUrls = [
  'https://prod-files-secure.s3.us-west-2.amazonaws.com/94916a04-58a4-436f-bcae-0e9e4be8c894/41f48037-ea50-4d5c-9c76-559d749dc8c4/drug_structure.png?X-Amz-Expires=3600&X-Amz-Signature=abc123',
  'https://www.notion.so/image/https%3A%2F%2Fs3.us-west-2.amazonaws.com%2Fsecure.notion-static.com%2Fdiagram.png?table=block&id=123',
  'https://s3.us-west-2.amazonaws.com/secure.notion-static.com/test.jpg',
  'https://example.com/normal-image.png'
];

function isNotionImageUrl(url) {
  const host = url.hostname.toLowerCase();
  const href = url.href.toLowerCase();
  return (
    host.includes('amazonaws.com') ||
    host.includes('notion.so') ||
    host.includes('notion-static.com') ||
    href.includes('prod-files-secure') ||
    href.includes('secure.notion-static.com') ||
    href.includes('notion.so/image') ||
    href.includes('s3.us-west-2.amazonaws.com')
  );
}

testUrls.forEach((u, idx) => {
  const res = isNotionImageUrl(new URL(u));
  console.log(`URL [${idx+1}] ${u.substring(0, 50)}... -> ${res ? 'MATCH (Notion/S3 Image)' : 'NO MATCH'}`);
});
