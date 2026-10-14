export function userFacingError(error: unknown, fallback = '服务暂时无法连接，请稍后重试。'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Gateways sometimes return their complete HTML error page instead of JSON.
  if (!message.trim() || /<\/?[a-z][^>]*>|<!doctype|<!--|failed to fetch|networkerror|load failed/i.test(message)) return fallback;
  return message;
}
