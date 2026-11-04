import { Suspense } from 'react'
import AppShell from '@/components/AppShell'
import MapHub from '@/features/map/MapHub'

export default function MapPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <p className="muted">지도를 준비하고 있어요.</p>
        </AppShell>
      }
    >
      <MapHub />
    </Suspense>
  )
}
