'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  AudioLines,
  Upload,
  Play,
  Pause,
  Undo2,
  Download,
  Trash2,
  RotateCcw,
  Music,
  FileText,
  Wand2,
  Keyboard,
  Gauge,
} from 'lucide-react'

interface Word {
  text: string
  lineIndex: number
  timestamp: number | null // detik (float), null = belum tersinkronisasi
}

interface Segment {
  text: string // satu kalimat / baris
  lineIndex: number // baris asal pada plain text
  timestamp: number | null
}

type SyncMode = 'enhanced' | 'simple'
type SentenceSplit = 'line' | 'comma' | 'period'

interface SavedState {
  lyricsText: string
  words: Word[]
  wordPointer: number
  segments: Segment[]
  segmentPointer: number
  mode: SyncMode
  sentenceSplit: SentenceSplit
  audioName: string
  playbackRate?: number
}

const STORAGE_KEY = 'lrc-sync-state-v2'
const OLD_STORAGE_KEY = 'lrc-sync-state-v1'

/** Pilihan kecepatan pemutaran (memperlambat lagu bertempo cepat) */
const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5]

/** Format detik -> mm:ss.xx (LRC, centisecond 2 digit) */
function formatTimestamp(seconds: number): string {
  const totalCentis = Math.round(seconds * 100)
  const minutes = Math.floor(totalCentis / 6000)
  const secs = Math.floor((totalCentis % 6000) / 100)
  const centis = totalCentis % 100
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

/** Parse lirik -> array kata (mode Enhanced) */
function parseWords(text: string): Word[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const result: Word[] = []
  lines.forEach((line, idx) => {
    line.split(/\s+/).forEach((tok) => {
      result.push({ text: tok, lineIndex: idx, timestamp: null })
    })
  })
  return result
}

/** Parse lirik -> array segmen/kalimat (mode Simple) sesuai cara pemisah */
function parseSegments(text: string, split: SentenceSplit): Segment[] {
  const result: Segment[] = []
  if (split === 'line') {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    lines.forEach((line, idx) => {
      result.push({ text: line, lineIndex: idx, timestamp: null })
    })
    return result
  }
  // comma / period: pecah per baris dulu, lalu pisah sesuai delimiter
  const delimiter = split === 'comma' ? /[,،，]/ : /[.。]/
  const lines = text.split('\n')
  let lineIdx = 0
  lines.forEach((rawLine) => {
    const line = rawLine.trim()
    if (line === '') {
      lineIdx++
      return
    }
    const parts = line
      .split(delimiter)
      .map((p) => p.trim())
      .filter((p) => p !== '')
    if (parts.length === 0) {
      lineIdx++
      return
    }
    parts.forEach((part) => {
      result.push({ text: part, lineIndex: lineIdx, timestamp: null })
    })
    lineIdx++
  })
  return result
}

export default function Home() {
  // --- State utama ---
  const [audioName, setAudioName] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [lyricsText, setLyricsText] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [wordPointer, setWordPointer] = useState(0)
  const [segments, setSegments] = useState<Segment[]>([])
  const [segmentPointer, setSegmentPointer] = useState(0)
  const [mode, setMode] = useState<SyncMode>('enhanced')
  const [sentenceSplit, setSentenceSplit] = useState<SentenceSplit>('line')
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [restored, setRestored] = useState(false)
  const [showEditPanel, setShowEditPanel] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)

  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lyricsScrollRef = useRef<HTMLDivElement>(null)
  const wordRefs = useRef<(HTMLButtonElement | null)[]>([])
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([])
  const prevLineRef = useRef<number | null>(null)

  // --- Restore dari localStorage saat mount (+ migrasi ringan dari v1) ---
  useEffect(() => {
    try {
      let raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        const v1 = localStorage.getItem(OLD_STORAGE_KEY)
        if (v1) {
          const d = JSON.parse(v1)
          raw = JSON.stringify({
            lyricsText: d.lyricsText || '',
            words: Array.isArray(d.words) ? d.words : [],
            wordPointer: typeof d.pointer === 'number' ? d.pointer : 0,
            segments: [],
            segmentPointer: 0,
            mode: 'enhanced',
            sentenceSplit: 'line',
            audioName: d.audioName || '',
            playbackRate: d.playbackRate || 1,
          })
        }
      }
      if (raw) {
        const data = JSON.parse(raw) as SavedState
        if (typeof data.lyricsText === 'string') setLyricsText(data.lyricsText)
        if (Array.isArray(data.words)) setWords(data.words)
        if (Array.isArray(data.segments)) setSegments(data.segments)
        if (typeof data.wordPointer === 'number') setWordPointer(data.wordPointer)
        if (typeof data.segmentPointer === 'number') setSegmentPointer(data.segmentPointer)
        if (data.mode === 'enhanced' || data.mode === 'simple') setMode(data.mode)
        if (
          data.sentenceSplit === 'line' ||
          data.sentenceSplit === 'comma' ||
          data.sentenceSplit === 'period'
        ) {
          setSentenceSplit(data.sentenceSplit)
        }
        if (typeof data.audioName === 'string') setAudioName(data.audioName)
        if (typeof data.playbackRate === 'number' && data.playbackRate > 0) {
          setPlaybackRate(data.playbackRate)
        }
      }
    } catch (e) {
      console.error('Gagal memuat data tersimpan', e)
    } finally {
      setRestored(true)
    }
  }, [])

  // --- Persist ke localStorage ---
  useEffect(() => {
    if (!restored) return
    try {
      const data: SavedState = {
        lyricsText,
        words,
        wordPointer,
        segments,
        segmentPointer,
        mode,
        sentenceSplit,
        audioName,
        playbackRate,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('Gagal menyimpan progres', e)
    }
  }, [
    lyricsText,
    words,
    wordPointer,
    segments,
    segmentPointer,
    mode,
    sentenceSplit,
    audioName,
    playbackRate,
    restored,
  ])

  // --- Update waktu audio secara halus dengan rAF ---
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio && !audio.paused) setCurrentTime(audio.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // --- Terapkan playbackRate & preservesPitch ke elemen audio ---
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const a = audio as HTMLAudioElement & { preservesPitch?: boolean }
    a.playbackRate = playbackRate
    try {
      a.preservesPitch = true
    } catch {
      /* noop */
    }
  }, [playbackRate, audioUrl])

  // --- Upload audio ---
  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    const url = URL.createObjectURL(file)
    setAudioUrl(url)
    setAudioName(file.name.replace(/\.[^.]+$/, ''))
    setCurrentTime(0)
    setIsPlaying(false)
  }

  // --- Load lyrics: parse kata (Enhanced) & segmen (Simple) ---
  const loadLyrics = useCallback(() => {
    if (!lyricsText.trim()) return
    const hasExisting =
      mode === 'enhanced'
        ? words.some((w) => w.timestamp !== null)
        : segments.some((s) => s.timestamp !== null)
    if (hasExisting) {
      const ok = window.confirm(
        'Memuat ulang lirik akan menghapus timestamp yang sudah Anda buat pada mode aktif. Lanjutkan?'
      )
      if (!ok) return
    }
    setWords(parseWords(lyricsText))
    setSegments(parseSegments(lyricsText, sentenceSplit))
    setWordPointer(0)
    setSegmentPointer(0)
    wordRefs.current = []
    segmentRefs.current = []
    prevLineRef.current = null
    setShowEditPanel(false)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [lyricsText, words, segments, mode, sentenceSplit])

  // --- Ganti cara pemisahan kalimat (mode Simple) ---
  const handleSplitChange = useCallback(
    (split: SentenceSplit) => {
      if (split === sentenceSplit) return
      if (!lyricsText.trim()) {
        setSentenceSplit(split)
        return
      }
      if (segments.some((s) => s.timestamp !== null)) {
        const ok = window.confirm(
          'Mengubah cara pemisahan kalimat akan menghapus timestamp Simple LRC. Lanjutkan?'
        )
        if (!ok) return
      }
      setSentenceSplit(split)
      setSegments(parseSegments(lyricsText, split))
      setSegmentPointer(0)
      segmentRefs.current = []
      prevLineRef.current = null
    },
    [sentenceSplit, lyricsText, segments]
  )

  // --- Ganti mode sinkronisasi ---
  const handleModeChange = useCallback((m: SyncMode) => {
    setMode(m)
    prevLineRef.current = null
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [])

  // --- Toggle play/pause ---
  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audioUrl) return
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  }, [audioUrl])

  // --- Catat timestamp item aktif & majukan pointer ---
  const recordTimestamp = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audioUrl) return
    const t = audio.currentTime
    if (mode === 'enhanced') {
      if (words.length === 0) return
      setWords((prev) => {
        if (prev.length === 0) return prev
        const next = prev.slice()
        const target = Math.min(wordPointer, next.length - 1)
        next[target] = { ...next[target], timestamp: t }
        return next
      })
      setWordPointer((p) => Math.min(p + 1, words.length - 1))
    } else {
      if (segments.length === 0) return
      setSegments((prev) => {
        if (prev.length === 0) return prev
        const next = prev.slice()
        const target = Math.min(segmentPointer, next.length - 1)
        next[target] = { ...next[target], timestamp: t }
        return next
      })
      setSegmentPointer((p) => Math.min(p + 1, segments.length - 1))
    }
  }, [mode, audioUrl, words.length, segments.length, wordPointer, segmentPointer])

  // --- Undo: mundur satu item (kata atau kalimat) ---
  const undo = useCallback(() => {
    if (mode === 'enhanced') setWordPointer((p) => Math.max(p - 1, 0))
    else setSegmentPointer((p) => Math.max(p - 1, 0))
  }, [mode])

  // --- Data aktif sesuai mode ---
  const activeCount = mode === 'enhanced' ? words.length : segments.length
  const activePointer = mode === 'enhanced' ? wordPointer : segmentPointer

  // --- Keyboard shortcuts global ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (activeCount === 0) return
      const activeEl = document.activeElement
      const isTypingTarget =
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLInputElement &&
          activeEl.type !== 'range' &&
          activeEl.type !== 'checkbox' &&
          activeEl.type !== 'file') ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable)
      if (isTypingTarget) return

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'Enter') {
        e.preventDefault()
        recordTimestamp()
      } else if (e.code === 'Backspace') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeCount, togglePlay, recordTimestamp, undo])

  // --- Seek progress bar ---
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    audio.currentTime = ratio * duration
    setCurrentTime(audio.currentTime)
  }

  // --- Kelompokkan kata per baris (Enhanced) ---
  const groupedWords = useMemo(() => {
    const groups: {
      lineIndex: number
      items: { word: Word; globalIdx: number }[]
    }[] = []
    let currentLine = -1
    let currentGroup: {
      lineIndex: number
      items: { word: Word; globalIdx: number }[]
    } | null = null
    words.forEach((word, idx) => {
      if (word.lineIndex !== currentLine) {
        currentGroup = { lineIndex: word.lineIndex, items: [] }
        groups.push(currentGroup)
        currentLine = word.lineIndex
      }
      currentGroup!.items.push({ word, globalIdx: idx })
    })
    return groups
  }, [words])

  // --- Kelompokkan segmen per baris asal (Simple) ---
  const groupedSegments = useMemo(() => {
    const groups: {
      lineIndex: number
      items: { seg: Segment; idx: number }[]
    }[] = []
    let currentLine = -1
    let currentGroup: {
      lineIndex: number
      items: { seg: Segment; idx: number }[]
    } | null = null
    segments.forEach((seg, idx) => {
      if (seg.lineIndex !== currentLine) {
        currentGroup = { lineIndex: seg.lineIndex, items: [] }
        groups.push(currentGroup)
        currentLine = seg.lineIndex
      }
      currentGroup!.items.push({ seg, idx })
    })
    return groups
  }, [segments])

  const syncedCount = useMemo(() => {
    if (mode === 'enhanced')
      return words.filter((w) => w.timestamp !== null).length
    return segments.filter((s) => s.timestamp !== null).length
  }, [mode, words, segments])
  const allSynced = activeCount > 0 && syncedCount === activeCount
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // --- Auto-scroll area lirik saat baris aktif berubah ---
  const scrollActiveIntoView = useCallback(
    (idx: number, smooth = true) => {
      const container = lyricsScrollRef.current
      const refs = mode === 'enhanced' ? wordRefs : segmentRefs
      const el = refs.current[idx]
      if (!container || !el) return
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const margin = 64
      const isVisible =
        elRect.top >= containerRect.top + margin &&
        elRect.bottom <= containerRect.bottom - margin
      if (isVisible) return
      const offset = elRect.top - containerRect.top + container.scrollTop
      const target = offset - container.clientHeight / 2 + elRect.height / 2
      container.scrollTo({
        top: Math.max(0, target),
        behavior: smooth ? 'smooth' : 'auto',
      })
    },
    [mode]
  )

  useEffect(() => {
    const data = mode === 'enhanced' ? words : segments
    const ptr = mode === 'enhanced' ? wordPointer : segmentPointer
    if (data.length === 0) {
      prevLineRef.current = null
      return
    }
    const curLine = data[ptr]?.lineIndex ?? null
    if (curLine !== prevLineRef.current) {
      scrollActiveIntoView(ptr, true)
      prevLineRef.current = curLine
    }
  }, [
    mode,
    words,
    segments,
    wordPointer,
    segmentPointer,
    scrollActiveIntoView,
  ])

  // --- Export LRC (Enhanced atau Simple) ---
  const exportLrc = useCallback(() => {
    if (activeCount === 0) return
    let body = ''
    if (mode === 'enhanced') {
      const sorted = [...groupedWords].sort((a, b) => a.lineIndex - b.lineIndex)
      body = sorted
        .map((group) => {
          const firstTime = group.items[0].word.timestamp ?? 0
          const parts = group.items.map(
            ({ word }) =>
              `<${formatTimestamp(word.timestamp ?? 0)}>${word.text}`
          )
          return `[${formatTimestamp(firstTime)}]${parts.join(' ')}`
        })
        .join('\n')
    } else {
      body = segments
        .map(
          (s) =>
            `[${formatTimestamp(s.timestamp ?? 0)}]${s.text}`
        )
        .join('\n')
    }

    const header: string[] = []
    if (audioName) header.push(`[ti:${audioName}]`)
    if (duration > 0) header.push(`[length:${formatTimestamp(duration)}]`)
    header.push(`[re:${mode}]`)
    const content =
      (header.length > 0 ? header.join('\n') + '\n' : '') + body + '\n'

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${audioName || 'lirik'}.lrc`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [mode, activeCount, groupedWords, segments, audioName, duration])

  // --- Reset semua ---
  const resetAll = useCallback(() => {
    const ok = window.confirm(
      'Hapus SEMUA data (lirik, timestamp, nama audio, mode)? Tindakan ini tidak bisa dibatalkan.'
    )
    if (!ok) return
    setWords([])
    setSegments([])
    setLyricsText('')
    setWordPointer(0)
    setSegmentPointer(0)
    setMode('enhanced')
    setSentenceSplit('line')
    setAudioName('')
    setAudioUrl('')
    setCurrentTime(0)
    setDuration(0)
    setShowEditPanel(false)
    setPlaybackRate(1)
    wordRefs.current = []
    segmentRefs.current = []
    prevLineRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(OLD_STORAGE_KEY)
    } catch {
      /* noop */
    }
  }, [])

  // --- Bersihkan timestamp mode aktif saja ---
  const clearTimestamps = useCallback(() => {
    const ok = window.confirm(
      `Bersihkan semua timestamp ${mode === 'enhanced' ? 'kata' : 'kalimat'}? Teks tetap dipertahankan.`
    )
    if (!ok) return
    if (mode === 'enhanced') {
      setWords((prev) => prev.map((w) => ({ ...w, timestamp: null })))
      setWordPointer(0)
    } else {
      setSegments((prev) => prev.map((s) => ({ ...s, timestamp: null })))
      setSegmentPointer(0)
    }
    prevLineRef.current = null
  }, [mode])

  // --- Turunan untuk tampilan ---
  const syncedPct =
    activeCount > 0 ? Math.round((syncedCount / activeCount) * 100) : 0
  const itemLabel = mode === 'enhanced' ? 'kata' : 'kalimat'
  const activeItemText =
    activePointer < activeCount
      ? (mode === 'enhanced' ? words[activePointer].text : segments[activePointer].text)
      : '—'
  const activeItemLine =
    activePointer < activeCount
      ? (mode === 'enhanced'
          ? words[activePointer].lineIndex
          : segments[activePointer].lineIndex) + 1
      : '-'

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 text-neutral-900">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      {/* Header */}
      <header className="bg-neutral-900 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-amber-400 text-neutral-900 flex items-center justify-center shrink-0">
              <AudioLines className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                LRC Sync Studio
              </h1>
              <p className="text-xs text-neutral-400 leading-tight">
                Sinkronisasi lirik &middot; Enhanced &amp; Simple LRC
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-400">
            <Keyboard className="size-4" />
            <span>Spasi &middot; Enter &middot; Backspace</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Step 1: Audio */}
        <Card className="py-5">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Music className="size-4 text-amber-500" />
              1. Unggah Audio
            </CardTitle>
            <CardDescription>
              Pilih file audio (mp3, wav, ogg, dll.) yang didukung browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleAudioUpload}
                className="hidden"
                id="audio-file-input"
              />
              <Button
                type="button"
                variant="default"
                onClick={() => fileInputRef.current?.click()}
                className="bg-neutral-900 text-white hover:bg-neutral-700"
              >
                <Upload className="size-4" />
                Pilih File Audio
              </Button>
              {audioName && (
                <span className="text-sm text-neutral-600 truncate max-w-full">
                  <span className="font-medium text-neutral-800">
                    {audioName}
                  </span>
                  {restored && !audioUrl && (
                    <span className="text-amber-600">
                      {' '}
                      (perlu diunggah ulang)
                    </span>
                  )}
                </span>
              )}
            </div>

            {audioUrl && (
              <div className="space-y-3">
                {/* Status play & waktu */}
                <div className="flex items-center gap-4">
                  <Button
                    type="button"
                    onClick={togglePlay}
                    size="icon"
                    className="size-12 rounded-full bg-neutral-900 text-white hover:bg-neutral-700 shrink-0"
                    aria-label={isPlaying ? 'Jeda' : 'Putar'}
                  >
                    {isPlaying ? (
                      <Pause className="size-5" />
                    ) : (
                      <Play className="size-5 ml-0.5" />
                    )}
                  </Button>
                  <div className="flex items-baseline gap-2 font-mono">
                    <span className="text-2xl font-bold tabular-nums text-neutral-900">
                      {formatTimestamp(currentTime)}
                    </span>
                    <span className="text-neutral-400">/</span>
                    <span className="text-sm tabular-nums text-neutral-500">
                      {formatTimestamp(duration)}
                    </span>
                  </div>
                  <div
                    className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${
                      isPlaying
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-neutral-100 text-neutral-500'
                    }`}
                  >
                    {isPlaying ? 'MEMUTAR' : 'DIJEDA'}
                  </div>
                </div>

                {/* Progress bar yang bisa di-seek */}
                <div
                  onClick={handleSeek}
                  className="relative h-3 bg-neutral-200 rounded-full cursor-pointer group"
                  role="slider"
                  aria-valuenow={currentTime}
                  aria-valuemax={duration}
                  aria-valuemin={0}
                  aria-label="Posisi audio"
                  tabIndex={-1}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-neutral-900 rounded-full transition-[width] duration-75"
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-4 bg-white border-2 border-neutral-900 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${progress}%` }}
                  />
                </div>

                {/* Kontrol kecepatan pemutaran */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                    <Gauge className="size-3.5" />
                    Kecepatan
                  </span>
                  <div className="flex items-center gap-1">
                    {SPEED_PRESETS.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setPlaybackRate(rate)}
                        className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-all ${
                          playbackRate === rate
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                        aria-label={`Kecepatan ${rate}x`}
                        aria-pressed={playbackRate === rate}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                  {playbackRate !== 1 && (
                    <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
                      Timestamp tetap mencatat posisi audio asli
                    </span>
                  )}
                </div>
              </div>
            )}

            {restored && !audioUrl && activeCount > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                Sesi tersimpan ditemukan. Silakan unggah ulang file audio yang
                sama untuk melanjutkan sinkronisasi &mdash; timestamp Anda tetap
                tersimpan.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Lyrics + Mode selector */}
        <Card className="py-5">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4 text-amber-500" />
                  2. Masukkan Lirik &amp; Pilih Mode
                </CardTitle>
                <CardDescription>
                  Tempel lirik plain text. Lalu pilih mode sinkronisasi.
                </CardDescription>
              </div>
              {activeCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditPanel((s) => !s)}
                >
                  {showEditPanel ? 'Sembunyikan' : 'Edit Lirik'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode selector */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-neutral-500">
                Mode Sinkronisasi
              </span>
              <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 w-full sm:w-auto">
                <SegmentButton
                  active={mode === 'enhanced'}
                  onClick={() => handleModeChange('enhanced')}
                  title="Enhanced LRC"
                  subtitle="per kata"
                />
                <SegmentButton
                  active={mode === 'simple'}
                  onClick={() => handleModeChange('simple')}
                  title="Simple LRC"
                  subtitle="per kalimat"
                />
              </div>
            </div>

            {/* Sentence split selector (mode Simple saja) */}
            {mode === 'simple' && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-neutral-500">
                  Cara Pemisahan Kalimat
                </span>
                <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 w-full sm:w-auto">
                  <PlainSegmentButton
                    active={sentenceSplit === 'line'}
                    onClick={() => handleSplitChange('line')}
                    label="Per Baris"
                  />
                  <PlainSegmentButton
                    active={sentenceSplit === 'comma'}
                    onClick={() => handleSplitChange('comma')}
                    label="Per Koma"
                  />
                  <PlainSegmentButton
                    active={sentenceSplit === 'period'}
                    onClick={() => handleSplitChange('period')}
                    label="Per Titik"
                  />
                </div>
                <p className="text-[11px] text-neutral-400">
                  {sentenceSplit === 'line' &&
                    'Setiap baris lirik = 1 kalimat / segmen.'}
                  {sentenceSplit === 'comma' &&
                    'Pecah lirik berdasarkan tanda koma (,). Beberapa segmen dapat muncul dari satu baris.'}
                  {sentenceSplit === 'period' &&
                    'Pecah lirik berdasarkan tanda titik (.). Beberapa segmen dapat muncul dari satu baris.'}
                </p>
              </div>
            )}

            {(showEditPanel || activeCount === 0) && (
              <>
                <Textarea
                  value={lyricsText}
                  onChange={(e) => setLyricsText(e.target.value)}
                  placeholder={
                    'Contoh:\nHello world\nThis is the second line\n...'
                  }
                  className="min-h-32 font-mono text-sm resize-y"
                />
                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="button"
                    onClick={loadLyrics}
                    disabled={!lyricsText.trim()}
                    className="bg-neutral-900 text-white hover:bg-neutral-700"
                  >
                    <Wand2 className="size-4" />
                    Load Lyrics
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLyricsText('')}
                    disabled={!lyricsText}
                  >
                    <Trash2 className="size-4" />
                    Bersihkan Teks
                  </Button>
                </div>
              </>
            )}
            {activeCount > 0 && !showEditPanel && (
              <p className="text-sm text-neutral-500">
                {activeCount} {itemLabel} dimuat.{' '}
                <button
                  type="button"
                  className="text-neutral-900 underline underline-offset-2 hover:text-amber-600"
                  onClick={() => setShowEditPanel(true)}
                >
                  Buka editor
                </button>{' '}
                untuk mengubah lirik.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 3: Sync workspace */}
        {activeCount > 0 && (
          <Card className="py-5">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wand2 className="size-4 text-amber-500" />
                    3. Sinkronisasi
                  </CardTitle>
                  <CardDescription>
                    Putar audio, lalu tekan <strong>Enter</strong> tepat saat{' '}
                    {mode === 'enhanced' ? 'kata' : 'kalimat'} aktif harus mulai
                    terdengar.
                  </CardDescription>
                </div>
                <span
                  className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                    allSynced
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-neutral-100 text-neutral-700'
                  }`}
                >
                  {syncedCount}/{activeCount} {itemLabel} ({syncedPct}%)
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Instruksi */}
              <div className="rounded-lg bg-neutral-100 border border-neutral-200 px-4 py-3 text-sm">
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                  <p className="flex items-center gap-2">
                    <Kbd>Spasi</Kbd>
                    <span className="text-neutral-600">Putar / Jeda audio</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Kbd>Enter</Kbd>
                    <span className="text-neutral-600">
                      Catat timestamp {mode === 'enhanced' ? 'kata' : 'kalimat'}{' '}
                      aktif &amp; lanjut
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Kbd>Backspace</Kbd>
                    <span className="text-neutral-600">
                      Mundur satu {mode === 'enhanced' ? 'kata' : 'kalimat'}{' '}
                      (Undo)
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Kbd>
                      Klik {mode === 'enhanced' ? 'kata' : 'kalimat'}
                    </Kbd>
                    <span className="text-neutral-600">
                      Pindahkan pointer ke sana
                    </span>
                  </p>
                </div>
              </div>

              {/* Pointer aktif info */}
              <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  {mode === 'enhanced' ? 'Kata Aktif' : 'Kalimat Aktif'}
                </span>
                <span className="text-lg font-bold text-neutral-900 break-all">
                  {activeItemText}
                </span>
                <span className="ml-auto text-xs text-amber-800 font-mono">
                  Baris {activeItemLine} &middot;{' '}
                  {mode === 'enhanced' ? 'Kata' : 'Kalimat'} ke-
                  {activePointer + 1}/{activeCount}
                </span>
              </div>

              {/* Daftar item (kata atau kalimat) */}
              <div
                ref={lyricsScrollRef}
                className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 custom-scroll"
              >
                {mode === 'enhanced' ? (
                  <div className="space-y-3">
                    {groupedWords.map((group) => (
                      <div
                        key={group.lineIndex}
                        className="flex flex-wrap items-start gap-1.5"
                      >
                        <span className="text-[10px] font-mono text-neutral-400 mt-1.5 mr-1 select-none shrink-0">
                          L{group.lineIndex + 1}
                        </span>
                        {group.items.map(({ word, globalIdx }) => {
                          const isActive = globalIdx === wordPointer
                          const isSynced = word.timestamp !== null
                          return (
                            <button
                              key={globalIdx}
                              type="button"
                              ref={(el) => {
                                wordRefs.current[globalIdx] = el
                              }}
                              onClick={() => setWordPointer(globalIdx)}
                              className={`px-2.5 py-1 rounded-md text-sm leading-tight transition-all duration-150 text-left ${
                                isActive
                                  ? 'bg-amber-300 text-neutral-900 font-bold ring-2 ring-amber-500 scale-105 shadow-sm'
                                  : isSynced
                                  ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 hover:scale-105'
                                  : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800'
                              }`}
                              title={
                                isSynced
                                  ? `${word.text} @ ${formatTimestamp(word.timestamp!)}`
                                  : `${word.text} (belum tersinkronisasi)`
                              }
                            >
                              {word.text}
                              {isSynced && (
                                <span className="block text-[10px] font-mono opacity-70 mt-0.5 tabular-nums">
                                  {formatTimestamp(word.timestamp!)}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedSegments.map((group) => (
                      <div key={group.lineIndex} className="space-y-1.5">
                        <span className="text-[10px] font-mono text-neutral-400 select-none">
                          L{group.lineIndex + 1}
                        </span>
                        {group.items.map(({ seg, idx }) => {
                          const isActive = idx === segmentPointer
                          const isSynced = seg.timestamp !== null
                          return (
                            <button
                              key={idx}
                              type="button"
                              ref={(el) => {
                                segmentRefs.current[idx] = el
                              }}
                              onClick={() => setSegmentPointer(idx)}
                              className={`w-full text-left px-3 py-2 rounded-md transition-all duration-150 flex items-center gap-3 ${
                                isActive
                                  ? 'bg-amber-300 text-neutral-900 font-bold ring-2 ring-amber-500 shadow-sm'
                                  : isSynced
                                  ? 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                                  : 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
                              }`}
                              title={
                                isSynced
                                  ? `${seg.text} @ ${formatTimestamp(seg.timestamp!)}`
                                  : `${seg.text} (belum tersinkronisasi)`
                              }
                            >
                              <span className="text-[10px] font-mono opacity-60 shrink-0">
                                #{idx + 1}
                              </span>
                              <span className="flex-1 break-words">
                                {seg.text}
                              </span>
                              {isSynced && (
                                <span className="text-xs font-mono opacity-80 shrink-0 tabular-nums">
                                  {formatTimestamp(seg.timestamp!)}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tombol kontrol */}
              <div className="flex gap-2 flex-wrap pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={undo}
                  disabled={activePointer === 0}
                >
                  <Undo2 className="size-4" />
                  Undo
                </Button>
                <Button
                  type="button"
                  onClick={exportLrc}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Download className="size-4" />
                  Export .lrc
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearTimestamps}
                  disabled={syncedCount === 0}
                >
                  <RotateCcw className="size-4" />
                  Reset Timestamp
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetAll}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="size-4" />
                  Reset Semua
                </Button>
              </div>

              {allSynced && (
                <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-800">
                  Semua {itemLabel} sudah tersinkronisasi. Klik{' '}
                  <strong>Export .lrc</strong> untuk mengunduh file{' '}
                  {mode === 'enhanced' ? 'Enhanced' : 'Simple'} LRC.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeCount === 0 && (
          <div className="text-center py-8 text-sm text-neutral-400">
            Belum ada lirik. Masukkan lirik di atas lalu klik{' '}
            <strong>Load Lyrics</strong>.
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-neutral-900 text-neutral-400 mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs sm:text-sm">
          Progres tersinkronisasi otomatis disimpan di browser (localStorage).{' '}
          <span className="text-neutral-300">
            Mode: {mode === 'enhanced' ? 'Enhanced LRC (per kata)' : 'Simple LRC (per kalimat)'}.{' '}
            Nama file unduhan mengikuti nama audio.
          </span>
        </div>
      </footer>

      {/* Custom scrollbar styling */}
      <style jsx global>{`
        .custom-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: #d4d4d4;
          border-radius: 4px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: #a3a3a3;
        }
      `}</style>
    </div>
  )
}

/** Tombol segmented control untuk mode (dengan subtitle) */
function SegmentButton({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
        active
          ? 'bg-white text-neutral-900 shadow-sm'
          : 'text-neutral-500 hover:text-neutral-800'
      }`}
      aria-pressed={active}
    >
      <span className="font-semibold">{title}</span>
      <span className="text-[11px] text-neutral-400">({subtitle})</span>
    </button>
  )
}

/** Tombol segmented control polos untuk cara pemisah kalimat */
function PlainSegmentButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
        active
          ? 'bg-white text-neutral-900 shadow-sm'
          : 'text-neutral-500 hover:text-neutral-800'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

/** Komponen kecil untuk menampilkan tombol keyboard */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-neutral-300 border-b-2 bg-white text-neutral-700 text-xs font-mono font-semibold shadow-sm">
      {children}
    </kbd>
  )
}
