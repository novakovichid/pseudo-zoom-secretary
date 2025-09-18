import json
import sys
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import librosa
import numpy as np
import srt
from faster_whisper import WhisperModel
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score


@dataclass
class SpeechSegment:
  start: float
  end: float
  speaker: int = 0
  text: str = ''


DEFAULT_VAD_OPTIONS = {
  'frame_length': 0.03,
  'hop_length': 0.01,
  'threshold_multiplier': 0.5,
  'min_speech': 0.4,
  'min_silence': 0.3
}

DEFAULT_DIARIZATION_OPTIONS = {
  'min_speakers': 2,
  'max_speakers': 6
}

DEFAULT_ASR_OPTIONS = {
  'model': 'medium',
  'device': 'cpu',
  'compute_type': 'int8',
  'language': 'ru',
  'beam_size': 5,
  'merge_gap': 1.5
}


def format_timestamp(value: float, separator: str = '.') -> str:
  hours = int(value // 3600)
  minutes = int((value % 3600) // 60)
  seconds = value % 60
  return f"{hours:02d}:{minutes:02d}:{seconds:06.3f}".replace('.', separator)


def energy_vad(
  audio: np.ndarray,
  sr: int,
  options: Dict[str, float]
) -> List[Tuple[float, float]]:
  frame_length = float(options.get('frame_length', DEFAULT_VAD_OPTIONS['frame_length']))
  hop_length = float(options.get('hop_length', DEFAULT_VAD_OPTIONS['hop_length']))
  min_speech = float(options.get('min_speech', DEFAULT_VAD_OPTIONS['min_speech']))
  min_silence = float(options.get('min_silence', DEFAULT_VAD_OPTIONS['min_silence']))
  manual_threshold = options.get('thr') or options.get('threshold')

  frame_samples = max(1, int(frame_length * sr))
  hop_samples = max(1, int(hop_length * sr))

  if len(audio) < frame_samples:
    return [(0.0, len(audio) / sr)]

  energies: List[float] = []
  for start in range(0, len(audio) - frame_samples + 1, hop_samples):
    frame = audio[start:start + frame_samples]
    energy = float(np.sqrt(np.mean(frame ** 2)))
    energies.append(energy)

  energies_np = np.array(energies, dtype=np.float32)
  if len(energies_np) == 0:
    return [(0.0, len(audio) / sr)]

  if manual_threshold is not None:
    threshold = float(manual_threshold)
  else:
    threshold = float(np.mean(energies_np) + np.std(energies_np) * options.get('threshold_multiplier', DEFAULT_VAD_OPTIONS['threshold_multiplier']))

  print(f"Порог энергии: {threshold:.6f}")

  speech_flags = energies_np > threshold
  segments: List[Tuple[float, float]] = []
  current_start: Optional[int] = None

  for index, is_speech in enumerate(speech_flags):
    if is_speech and current_start is None:
      current_start = index
    elif not is_speech and current_start is not None:
      seg_start = current_start * hop_length
      seg_end = min(len(audio) / sr, index * hop_length + frame_length)
      if segments and seg_start - segments[-1][1] < min_silence:
        prev_start, _ = segments[-1]
        segments[-1] = (prev_start, seg_end)
      else:
        segments.append((seg_start, seg_end))
      current_start = None

  if current_start is not None:
    seg_start = current_start * hop_length
    seg_end = len(audio) / sr
    if segments and seg_start - segments[-1][1] < min_silence:
      prev_start, _ = segments[-1]
      segments[-1] = (prev_start, seg_end)
    else:
      segments.append((seg_start, seg_end))

  refined: List[Tuple[float, float]] = []
  for seg_start, seg_end in segments:
    if seg_end - seg_start >= min_speech:
      refined.append((seg_start, seg_end))

  if not refined:
    refined = [(0.0, len(audio) / sr)]

  print(f"После VAD сегментов: {len(refined)}")
  return refined


def extract_features(audio: np.ndarray, sr: int, segments: Sequence[Tuple[float, float]]) -> np.ndarray:
  feature_vectors: List[np.ndarray] = []
  min_samples = int(0.25 * sr)
  feature_dim = 78

  for seg_start, seg_end in segments:
    start_idx = max(0, int(seg_start * sr))
    end_idx = min(len(audio), int(seg_end * sr))
    segment_audio = audio[start_idx:end_idx]
    if len(segment_audio) == 0:
      feature_vectors.append(np.zeros(feature_dim, dtype=np.float32))
      continue
    if len(segment_audio) < min_samples:
      pad_width = min_samples - len(segment_audio)
      segment_audio = np.pad(segment_audio, (0, pad_width), mode='edge')

    mfcc = librosa.feature.mfcc(y=segment_audio, sr=sr, n_mfcc=13)
    delta = librosa.feature.delta(mfcc)
    delta2 = librosa.feature.delta(mfcc, order=2)
    stack = np.vstack([mfcc, delta, delta2])
    feat_vec = np.concatenate([np.mean(stack, axis=1), np.std(stack, axis=1)])
    feature_vectors.append(feat_vec.astype(np.float32))

  if not feature_vectors:
    return np.zeros((0, feature_dim), dtype=np.float32)

  return np.vstack(feature_vectors)


def estimate_speaker_count(features: np.ndarray, diar_options: Dict[str, int]) -> int:
  if features.shape[0] <= 1:
    return 1

  num_speakers = diar_options.get('num_speakers')
  if num_speakers:
    return max(1, int(num_speakers))

  min_speakers = int(diar_options.get('min_speakers', DEFAULT_DIARIZATION_OPTIONS['min_speakers']))
  max_speakers = int(diar_options.get('max_speakers', DEFAULT_DIARIZATION_OPTIONS['max_speakers']))
  max_speakers = min(max_speakers, features.shape[0])
  best_score = -1.0
  best_k = 1

  for k in range(min_speakers, max_speakers + 1):
    if k <= 1 or k > features.shape[0]:
      continue
    clustering = AgglomerativeClustering(n_clusters=k)
    labels = clustering.fit_predict(features)
    if len(set(labels)) <= 1:
      continue
    score = silhouette_score(features, labels)
    if score > best_score:
      best_score = score
      best_k = k

  if best_k <= 1:
    best_k = 1

  print(f"Оценено количество спикеров: {best_k}")
  return best_k


def diarize_segments(segments: Sequence[Tuple[float, float]], features: np.ndarray, diar_options: Dict[str, int]) -> List[SpeechSegment]:
  if not segments:
    return []

  num_speakers = estimate_speaker_count(features, diar_options)

  if num_speakers <= 1:
    return [SpeechSegment(start=s, end=e, speaker=0) for s, e in segments]

  clustering = AgglomerativeClustering(n_clusters=num_speakers)
  labels = clustering.fit_predict(features)

  diarized = [SpeechSegment(start=s, end=e, speaker=int(labels[idx])) for idx, (s, e) in enumerate(segments)]
  diarized.sort(key=lambda seg: seg.start)
  return diarized


def assign_speaker_for_interval(
  start: float,
  end: float,
  segments: Sequence[SpeechSegment]
) -> int:
  if not segments:
    return 0

  midpoint = (start + end) / 2.0
  best_index = None
  best_overlap = 0.0

  for idx, segment in enumerate(segments):
    overlap = min(end, segment.end) - max(start, segment.start)
    if overlap > best_overlap:
      best_overlap = overlap
      best_index = idx
    if segment.start <= midpoint <= segment.end:
      return segment.speaker

  if best_index is not None:
    return segments[best_index].speaker

  distances = [min(abs(midpoint - seg.start), abs(midpoint - seg.end)) for seg in segments]
  return segments[int(np.argmin(distances))].speaker


def merge_transcript_segments(
  transcript_segments,
  diarized_segments: Sequence[SpeechSegment],
  merge_gap: float
) -> List[SpeechSegment]:
  merged: List[SpeechSegment] = []

  for seg in transcript_segments:
    text = seg.text.strip()
    if not text:
      continue
    speaker = assign_speaker_for_interval(seg.start, seg.end, diarized_segments)
    if merged and merged[-1].speaker == speaker and seg.start - merged[-1].end <= merge_gap:
      merged[-1].end = seg.end
      merged[-1].text = (merged[-1].text + ' ' + text).strip()
    else:
      speech_seg = SpeechSegment(start=seg.start, end=seg.end, speaker=speaker, text=text)
      merged.append(speech_seg)

  return merged


def save_transcripts(
  merged_segments: Sequence[SpeechSegment],
  output_dir: Path
):
  txt_lines: List[str] = []
  subtitles: List[srt.Subtitle] = []

  for index, segment in enumerate(merged_segments, start=1):
    text = getattr(segment, 'text', '').strip()
    if not text:
      continue
    time_range = f"[{format_timestamp(segment.start)}–{format_timestamp(segment.end)}]"
    txt_lines.append(f"{time_range} Спикер {segment.speaker + 1}: {text}")
    subtitles.append(
      srt.Subtitle(
        index=index,
        start=timedelta(seconds=segment.start),
        end=timedelta(seconds=segment.end),
        content=f"Спикер {segment.speaker + 1}: {text}"
      )
    )

  txt_path = output_dir / 'transcript_speakers.txt'
  srt_path = output_dir / 'transcript_speakers.srt'

  txt_path.write_text('\n'.join(txt_lines), encoding='utf-8')
  srt_path.write_text(srt.compose(subtitles), encoding='utf-8')

  print(f"Сохранено: {txt_path}")
  print(f"Сохранено: {srt_path}")


def main() -> int:
  if len(sys.argv) < 2:
    print('Использование: process_audio.py <путь к wav> [json options]')
    return 1

  wav_path = Path(sys.argv[1])
  if not wav_path.exists():
    print(f'Файл не найден: {wav_path}')
    return 1

  options: Dict[str, Dict] = {}
  if len(sys.argv) > 2:
    try:
      options = json.loads(sys.argv[2])
    except json.JSONDecodeError as exc:
      print(f'Не удалось разобрать параметры: {exc}. Используются значения по умолчанию.')
      options = {}

  vad_options = {**DEFAULT_VAD_OPTIONS, **options.get('vad', {})}
  diarization_options = {**DEFAULT_DIARIZATION_OPTIONS, **options.get('diarization', {})}
  asr_options = {**DEFAULT_ASR_OPTIONS, **options.get('asr', {})}

  target_sr = 16000
  print(f'Загрузка аудио {wav_path}...')
  audio, sr = librosa.load(wav_path, sr=target_sr, mono=True)
  duration = len(audio) / sr
  print(f'Аудио загружено: {duration:.2f} с, sr={sr}')

  segments = energy_vad(audio, sr, vad_options)
  features = extract_features(audio, sr, segments)
  diarized_segments = diarize_segments(segments, features, diarization_options)
  print(f'Диаризация готова: {len(diarized_segments)} сегментов.')

  print('Загрузка модели Whisper...')
  model = WhisperModel(asr_options['model'], device=asr_options['device'], compute_type=asr_options['compute_type'])
  print('Модель загружена, начало распознавания...')

  segments_iter, info = model.transcribe(
    str(wav_path),
    beam_size=int(asr_options.get('beam_size', DEFAULT_ASR_OPTIONS['beam_size'])),
    language=asr_options.get('language', DEFAULT_ASR_OPTIONS['language']),
    vad_filter=False
  )
  transcript_segments = list(segments_iter)
  language_info = getattr(info, 'language', asr_options.get('language', 'unknown'))
  print(f"Получено сегментов ASR: {len(transcript_segments)} (язык: {language_info})")

  merged_segments = merge_transcript_segments(
    transcript_segments,
    diarized_segments,
    float(asr_options.get('merge_gap', DEFAULT_ASR_OPTIONS['merge_gap']))
  )
  print(f'После объединения сегментов: {len(merged_segments)}')

  output_dir = wav_path.parent
  save_transcripts(merged_segments, output_dir)

  return 0


if __name__ == '__main__':
  sys.exit(main())
