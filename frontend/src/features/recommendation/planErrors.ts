import { ApiError } from '@/lib/api'
import type { PlanState } from './planTypes'

export function planRequestError(error: unknown, operation: 'poll' | 'save' | 'recommend'): string {
  const action = operation === 'recommend' ? '추천 조회' : operation === 'save' ? '출발지 저장' : '최신 상태 확인'
  if (!(error instanceof ApiError)) return `${action} 중 연결이 끊겼어요. 인터넷 연결과 서버 상태를 확인해 주세요.`
  const status = error.status
  if (status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요. (401)'
  if (status === 403) return '이 그룹에 접근할 권한이 없어요. (403)'
  if (status === 404) return '추천 링크 또는 API 경로를 찾지 못했어요. (404)'
  if (status === 504) return `${action} 응답 시간이 초과됐어요. 서버에서 처리가 끝났는지 다시 확인해 주세요. (504)`
  const generic = !error.message || error.message === '요청에 실패했습니다.'
  if (!generic) return `${error.message} (${status})`
  if (status === 429) return `${action} 요청이 너무 많아요. 잠시 후 다시 시도해 주세요. (429)`
  if (status >= 500) return `${action} 중 서버 오류가 발생했어요. Vercel 백엔드 로그를 확인해 주세요. (${status})`
  return `${action}에 실패했어요. (${status})`
}

// 타임아웃 이후 실제로 새로운 결과가 저장된 경우에만 과거 추천 오류를 해제한다.
export function receivedNewResult(next: PlanState, previousGeneratedAt: string): boolean {
  return Boolean(next.result?.generated_at && next.result.generated_at !== previousGeneratedAt)
}
