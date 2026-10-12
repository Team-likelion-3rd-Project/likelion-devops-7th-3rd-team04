// 시크릿 키처럼 하드코딩된 기본값으로 대체되어서는 안 되는 필수 환경변수를 읽는 유틸입니다.
// `process.env.X || '기본값'` 패턴은 운영 환경에 값 설정을 깜빡해도 앱이 조용히 뜨고,
// 소스에 박힌 그 '기본값'(예: dev-access-secret)을 아는 사람이라면 누구나 토큰을 위조할 수 있게
// 만듭니다. 값이 없으면 즉시 에러를 던져서, 실행 시점(부팅 또는 최초 호출)에 바로 드러나게 합니다.
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `필수 환경변수 ${key}가 설정되지 않았습니다. .env 파일 또는 배포 환경 변수를 확인하세요.`,
    );
  }
  return value;
}
