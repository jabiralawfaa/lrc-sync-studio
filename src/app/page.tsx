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

interface SavedState {
  lyricsText: string
  words: Word[]
  pointer: number
  audioName: string
  playbackRate?: number
}

const STORAGE_KEY = 'lrc-sync-state-v1'

/** Pilihan kecepatan pemutaran (memperlambat lagu bertempo cepat) */
const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5]

/** Format detik -> mm:ss.xx (Enhanced LRC, centisecond 2 digit) */
function formatTimestamp(seconds: number): string {
  const totalCentis = Math.round(seconds * 100)
  const minutes = Math.floor(totalCentis / 6000)
  const secs = Math.floor((totalCentis % 6000) / 100)
  const centis = totalCentis % 100
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

export default function Home() {
  // --- State utama ---
  const [audioName, setAudioName] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [lyricsText, setLyricsText] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [pointer, setPointer] = useState(0)
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
  const prevLineRef = useRef<number | null>(null)

  // --- Restore dari localStorage saat mount ---
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved) as SavedState
        if (typeof data.lyricsText === 'string') setLyricsText(data.lyricsText)
        if (Array.isArray(data.words)) setWords(data.words)
        if (typeof data.pointer === 'number') setPointer(data.pointer)
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
        pointer,
        audioName,
        playbackRate,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('Gagal menyimpan progres', e)
    }
  }, [lyricsText, words, pointer, audioName, playbackRate, restored])

  // --- Update waktu audio secara halus dengan rAF ---
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio && !audio.paused) {
        setCurrentTime(audio.currentTime)
      }
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
    // Pertahankan nada asli saat kecepatan diubah agar tidak terdengar
    // terlalu rendah saat diperlambat.
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

  // --- Load lyrics: parse plain text -> array of Word ---
  const loadLyrics = useCallback(() => {
    if (!lyricsText.trim()) return
    // Konfirmasi jika sudah ada kata tersinkronisasi
    if (words.some((w) => w.timestamp !== null)) {
      const ok = window.confirm(
        'Memuat ulang lirik akan menghapus timestamp yang sudah Anda buat. Lanjutkan?'
      )
      if (!ok) return
    }
    const lines = lyricsText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
    const newWords: Word[] = []
    lines.forEach((line, lineIdx) => {
      const tokens = line.split(/\s+/)
      tokens.forEach((tok) => {
        newWords.push({ text: tok, lineIndex: lineIdx, timestamp: null })
      })
    })
    setWords(newWords)
    setPointer(0)
    setShowEditPanel(false)
    // Blur agar tombol tidak tertahan fokus (spasi/enter langsung ke sync)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [lyricsText, words])

  // --- Toggle play/pause ---
  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audioUrl) return
    if (audio.paused) {
      void audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [audioUrl])

  // --- Catat timestamp kata aktif & majukan pointer ---
  const recordTimestamp = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audioUrl || words.length === 0) return
    const t = audio.currentTime
    setWords((prev) => {
      if (prev.length === 0) return prev
      const next = prev.slice()
      const target = Math.min(pointer, next.length - 1)
      next[target] = { ...next[target], timestamp: t }
      return next
    })
    setPointer((prev) => Math.min(prev + 1, words.length - 1))
  }, [audioUrl, pointer, words.length])

  // --- Undo: mundur satu kata ---
  const undo = useCallback(() => {
    setPointer((prev) => Math.max(prev - 1, 0))
  }, [])

  // --- Keyboard shortcuts global ---
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (words.length === 0) return
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
  }, [words.length, togglePlay, recordTimestamp, undo])

  // --- Seek progress bar ---
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    audio.currentTime = ratio * duration
    setCurrentTime(audio.currentTime)
  }

  // --- Kelompokkan kata per baris (urut global dipertahankan) ---
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

  const syncedCount = useMemo(
    () => words.filter((w) => w.timestamp !== null).length,
    [words]
  )
  const allSynced = words.length > 0 && syncedCount === words.length
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  // --- Auto-scroll area lirik saat baris aktif berubah ---
  // Hanya scroll jika kata aktif berpindah ke baris yang berbeda dari sebelumnya,
  // sehingga pengguna tidak perlu menscroll manual saat pointer mencapai bawah.
  const scrollActiveIntoView = useCallback((idx: number, smooth = true) => {
    const container = lyricsScrollRef.current
    const el = wordRefs.current[idx]
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
  }, [])

  useEffect(() => {
    if (words.length === 0) {
      prevLineRef.current = null
      return
    }
    const curLine = words[pointer]?.lineIndex ?? null
    if (curLine !== prevLineRef.current) {
      scrollActiveIntoView(pointer, true)
      prevLineRef.current = curLine
    }
  }, [pointer, words, scrollActiveIntoView])

  // --- Export Enhanced LRC ---
  const exportLrc = useCallback(() => {
    if (words.length === 0) return
    const sortedGroups = [...groupedWords].sort(
      (a, b) => a.lineIndex - b.lineIndex
    )
    const lrcLines = sortedGroups.map((group) => {
      const firstTime = group.items[0].word.timestamp ?? 0
      const parts = group.items.map(({ word }) => {
        const t = word.timestamp ?? 0
        return `<${formatTimestamp(t)}>${word.text}`
      })
      return `[${formatTimestamp(firstTime)}]${parts.join(' ')}`
    })

    const header: string[] = []
    if (audioName) header.push(`[ti:${audioName}]`)
    if (duration > 0) header.push(`[length:${formatTimestamp(duration)}]`)
    header.push(`[re:enhanced]`)
    const content =
      (header.length > 0 ? header.join('\n') + '\n' : '') +
      lrcLines.join('\n') +
      '\n'

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${audioName || 'lirik'}.lrc`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [words, groupedWords, audioName, duration])

  // --- Reset semua ---
  const resetAll = useCallback(() => {
    const ok = window.confirm(
      'Hapus SEMUA data (lirik, timestamp, nama audio)? Tindakan ini tidak bisa dibatalkan.'
    )
    if (!ok) return
    setWords([])
    setLyricsText('')
    setPointer(0)
    setAudioName('')
    setAudioUrl('')
    setCurrentTime(0)
    setDuration(0)
    setShowEditPanel(false)
    setPlaybackRate(1)
    if (fileInputRef.current) fileInputRef.current.value = ''
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* noop */
    }
  }, [])

  // --- Bersihkan timestamp saja (pertahankan lirik) ---
  const clearTimestamps = useCallback(() => {
    const ok = window.confirm('Bersihkan semua timestamp? Kata-kata tetap dipertahankan.')
    if (!ok) return
    setWords((prev) => prev.map((w) => ({ ...w, timestamp: null })))
    setPointer(0)
  }, [])

  const syncedPct =
    words.length > 0 ? Math.round((syncedCount / words.length) * 100) : 0

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
              <h1 className="text-lg font-bold leading-tight">LRC Sync Studio</h1>
              <p className="text-xs text-neutral-400 leading-tight">
                Sinkronisasi lirik per kata &middot; Enhanced LRC
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
                  <span className="font-medium text-neutral-800">{audioName}</span>
                  {restored && !audioUrl && (
                    <span className="text-amber-600"> (perlu diunggah ulang)</span>
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

            {restored && !audioUrl && words.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                Sesi tersimpan ditemukan. Silakan unggah ulang file audio yang
                sama untuk melanjutkan sinkronisasi &mdash; timestamp Anda tetap
                tersimpan.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Lyrics input / edit toggle */}
        <Card className="py-5">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="size-4 text-amber-500" />
                  2. Masukkan Lirik
                </CardTitle>
                <CardDescription>
                  Tempel lirik plain text, satu baris per baris lirik.
                </CardDescription>
              </div>
              {words.length > 0 && (
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
          <CardContent className="space-y-3">
            {(showEditPanel || words.length === 0) && (
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
            {words.length > 0 && !showEditPanel && (
              <p className="text-sm text-neutral-500">
                {words.length} kata dimuat dari {groupedWords.length} baris.{' '}
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
        {words.length > 0 && (
          <Card className="py-5">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wand2 className="size-4 text-amber-500" />
                    3. Sinkronisasi
                  </CardTitle>
                  <CardDescription>
                    Putar audio, lalu tekan <strong>Enter</strong> tepat saat
                    kata aktif harus mulai terdengar.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                      allSynced
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    {syncedCount}/{words.length} kata ({syncedPct}%)
                  </span>
                </div>
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
                      Catat timestamp kata aktif &amp; lanjut
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Kbd>Backspace</Kbd>
                    <span className="text-neutral-600">
                      Mundur satu kata (Undo)
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Kbd>Klik kata</Kbd>
                    <span className="text-neutral-600">
                      Pindahkan pointer ke kata itu
                    </span>
                  </p>
                </div>
              </div>

              {/* Pointer aktif info */}
              <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Kata Aktif
                </span>
                <span className="text-lg font-bold text-neutral-900 break-all">
                  {pointer < words.length ? words[pointer].text : '—'}
                </span>
                <span className="ml-auto text-xs text-amber-800 font-mono">
                  Baris {pointer < words.length ? words[pointer].lineIndex + 1 : '-'}{' '}
                  &middot; Kata ke-{pointer + 1}/{words.length}
                </span>
              </div>

              {/* Daftar kata */}
              <div
                ref={lyricsScrollRef}
                className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 custom-scroll"
              >
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
                        const isActive = globalIdx === pointer
                        const isSynced = word.timestamp !== null
                        return (
                          <button
                            key={globalIdx}
                            type="button"
                            ref={(el) => {
                              wordRefs.current[globalIdx] = el
                            }}
                            onClick={() => setPointer(globalIdx)}
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
              </div>

              {/* Tombol kontrol */}
              <div className="flex gap-2 flex-wrap pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={undo}
                  disabled={pointer === 0}
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
                  Semua kata sudah tersinkronisasi. Anda bisa mengeklik{' '}
                  <strong>Export .lrc</strong> untuk mengunduh file Enhanced LRC.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {words.length === 0 && (
          <div className="text-center py-8 text-sm text-neutral-400">
            Belum ada lirik. Masukkan lirik di atas lalu klik{' '}
            <strong>Load Lyrics</strong>.
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-neutral-900 text-neutral-400 mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center text-xs sm:text-sm">
          Progres tersinkronisasi otomatis disimpan di browser
          (localStorage).{' '}
          <span className="text-neutral-300">
            Nama file unduhan mengikuti nama audio ({'<nama-audio>'}.lrc).
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

/** Komponen kecil untuk menampilkan tombol keyboard */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-neutral-300 border-b-2 bg-white text-neutral-700 text-xs font-mono font-semibold shadow-sm">
      {children}
    </kbd>
  )
}
