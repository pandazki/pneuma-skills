import { useState, useEffect, useRef } from "react";

export interface WaveformData {
  peaks: number[];
  duration: number;
}

interface Options {
  audioUrl: string;
  bars: number;
  /** If set, only analyze the first N seconds of the audio (for BGM longer than project). */
  maxDuration?: number;
}

/**
 * Decode an audio file and compute waveform peak data for visualization.
 * Results are cached by audioUrl.
 */
export function useWaveform(options: Options | null): {
  waveform: WaveformData | null;
  loading: boolean;
} {
  const [waveform, setWaveform] = useState<WaveformData | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, WaveformData>>(new Map());
  const abortRef = useRef(false);

  useEffect(() => {
    if (!options || !options.audioUrl) {
      setWaveform(null);
      setLoading(false);
      return;
    }

    const { audioUrl, bars, maxDuration } = options;
    const cacheKey = `${audioUrl}:${bars}${maxDuration ? `:${maxDuration}` : ""}`;

    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setWaveform(cached);
      setLoading(false);
      return;
    }

    abortRef.current = false;
    setLoading(true);

    const audioCtx = new AudioContext();

    fetch(audioUrl)
      .then((res) => res.arrayBuffer())
      .then((buf) => audioCtx.decodeAudioData(buf))
      .then((audioBuffer) => {
        if (abortRef.current) return;

        const channel = audioBuffer.getChannelData(0);
        // If maxDuration is set, only analyze that portion of the audio
        const usableSamples = maxDuration
          ? Math.min(channel.length, Math.floor(maxDuration * audioBuffer.sampleRate))
          : channel.length;
        const samplesPerBar = Math.floor(usableSamples / bars);
        const peaks: number[] = [];

        for (let i = 0; i < bars; i++) {
          let max = 0;
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, usableSamples);
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channel[j]);
            if (abs > max) max = abs;
          }
          peaks.push(max);
        }

        // Normalize to 0-1
        const globalMax = Math.max(...peaks, 0.001);
        const normalized = peaks.map((p) => p / globalMax);

        const data: WaveformData = { peaks: normalized, duration: audioBuffer.duration };
        cacheRef.current.set(cacheKey, data);
        setWaveform(data);
        setLoading(false);
      })
      .catch(() => {
        if (!abortRef.current) setLoading(false);
      })
      .finally(() => {
        audioCtx.close();
      });

    return () => {
      abortRef.current = true;
    };
  }, [options?.audioUrl, options?.bars, options?.maxDuration]);

  return { waveform, loading };
}
