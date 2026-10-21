import { Suspense } from 'react'
import RecommendationPage from '@/features/recommendation/RecommendationPage'

export default function Page() {
  return (
    <main style={{ padding: '32px 24px' }}>
      <Suspense fallback={<p>추천 페이지를 준비하고 있어요.</p>}><RecommendationPage /></Suspense>
    </main>
  )
}
