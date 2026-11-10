'use client'

import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import type { PlanState, SavedDeparture } from './planTypes'
import { planRequestError, receivedNewResult } from './planErrors'

export function usePlacePlan(groupId: string, planId: string) {
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [connected, setConnected] = useState(false)
  const mounted = useRef(false)
  const mutation = useRef(false)
  const recommendationBusy = useRef(false)
  const version = useRef(0)
  const recommendationErrorVersion = useRef<string | null>(null)
  const base = `/groups/${groupId}/place-plans/${planId}`

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      const current = version.current
      try {
        const next = await api<PlanState>(base)
        if (cancelled || current !== version.current || mutation.current) return
        setPlan(next)
        setConnected(true)
        setConnectionError('')
        if (recommendationErrorVersion.current !== null && receivedNewResult(next, recommendationErrorVersion.current)) {
          recommendationErrorVersion.current = null
          setError('')
        }
      } catch (err) {
        if (!cancelled && current === version.current && !mutation.current) {
          setConnected(false)
          if (err instanceof ApiError && [401, 403, 404].includes(err.status)) setPlan(null)
          setConnectionError(planRequestError(err, 'poll'))
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 3000)
      }
    }
    void poll()
    return () => {
      mounted.current = false
      cancelled = true
      version.current += 1
      clearTimeout(timer)
    }
  }, [base])

  async function saveDeparture(departure: SavedDeparture | null, targetUserId?: number) {
    if (mutation.current) return false
    mutation.current = true
    version.current += 1
    setSaving(true)
    setError('')
    recommendationErrorVersion.current = null
    // 저장 중에도 이전 추천을 보여주지 않는다.
    setPlan((current) => current ? { ...current, result: null } : current)
    try {
      const next = await api<PlanState>(`${base}/my-departure${!departure && targetUserId ? `?target_user_id=${targetUserId}` : ''}`, departure
        ? { method: 'PUT', body: { place_id: departure.place_id, name: departure.name, address: departure.address, latitude: departure.latitude, longitude: departure.longitude, target_user_id: targetUserId } } : { method: 'DELETE' })
      if (mounted.current) { setPlan(next); setConnected(true); setConnectionError('') }
      return true
    } catch (err) {
      if (mounted.current) {
        setConnected(false)
        setError(planRequestError(err, 'save'))
      }
      return false
    } finally {
      version.current += 1
      mutation.current = false
      if (mounted.current) setSaving(false)
    }
  }

  async function recommend() {
    if (recommendationBusy.current || mutation.current || !connected) return
    recommendationBusy.current = true
    setRecommending(true)
    setError('')
    recommendationErrorVersion.current = null
    const previousGeneratedAt = plan?.result?.generated_at ?? ''
    try {
      // POST 결과를 바로 덮어쓰지 않고 이후 GET이 서버의 최신 결과를 가져온다.
      await api<PlanState>(`${base}/recommend`, { method: 'POST' })
      if (mounted.current) { setConnected(true); setConnectionError('') }
    } catch (err) {
      if (mounted.current) {
        recommendationErrorVersion.current = previousGeneratedAt
        setError(planRequestError(err, 'recommend'))
      }
    } finally {
      recommendationBusy.current = false
      if (mounted.current) setRecommending(false)
    }
  }
  return { plan, error: connectionError || error, saving, recommending, connected, saveDeparture, recommend }
}
