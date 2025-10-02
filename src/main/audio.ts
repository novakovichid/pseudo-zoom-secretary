import fs from 'node:fs';
import path from 'node:path';
import { AudioIO, SampleFormat16Bit, getDevices } from 'naudiodon';
import type { DeviceInfo } from '../shared/types';

const TARGET_SAMPLE_RATE = 16_000;
const SOURCE_SAMPLE_RATE = 48_000;
const CHANNEL_COUNT = 2;
const BYTES_PER_SAMPLE = 2;

let audioIO: AudioIO | null = null;
let fileDescriptor: number | null = null;
let currentFilePath: string | null = null;
let dataBytes = 0;

function ensureDir(filePath: string) {
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function writeWavHeader(fd: number, dataLength: number) {
  const header = Buffer.alloc(44);
  const byteRate = TARGET_SAMPLE_RATE * BYTES_PER_SAMPLE;
  const blockAlign = BYTES_PER_SAMPLE;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(TARGET_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  fs.writeSync(fd, header, 0, 44, 0);
}

function interleavedToMono(buffer: Buffer, channels: number): Int16Array {
  const totalSamples = buffer.length / BYTES_PER_SAMPLE;
  const frameCount = totalSamples / channels;
  const mono = new Int16Array(frameCount);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const sampleIndex = (frameIndex * channels + channel) * BYTES_PER_SAMPLE;
      sum += buffer.readInt16LE(sampleIndex);
    }
    mono[frameIndex] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
  }

  return mono;
}

function downsample(input: Int16Array, inputRate: number, outputRate: number): Int16Array {
  if (inputRate === outputRate) {
    return new Int16Array(input);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const weight = position - leftIndex;
    const sample = input[leftIndex] * (1 - weight) + input[rightIndex] * weight;
    output[index] = Math.max(-32768, Math.min(32767, Math.round(sample)));
  }

  return output;
}

function writeSamples(fd: number, samples: Int16Array) {
  if (samples.length === 0) {
    return;
  }

  const buffer = Buffer.alloc(samples.length * BYTES_PER_SAMPLE);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], index * BYTES_PER_SAMPLE);
  }

  fs.writeSync(fd, buffer);
  dataBytes += buffer.length;
}

export function listOutputDevices(): DeviceInfo[] {
  const devices = getDevices() as DeviceInfo[];
  return devices
    .filter((device) =>
      device.maxOutputChannels > 0 &&
      device.hostAPIName &&
      device.hostAPIName.toLowerCase().includes('wasapi')
    )
    .map((device) => ({
      id: device.id,
      name: device.name,
      hostAPIName: device.hostAPIName,
      maxOutputChannels: device.maxOutputChannels,
    }));
}

export function startAudioCapture(outPath: string, deviceId?: number): string {
  if (audioIO) {
    throw new Error('Запись уже запущена.');
  }

  const resolvedPath = path.resolve(outPath);
  ensureDir(resolvedPath);

  fileDescriptor = fs.openSync(resolvedPath, 'w');
  writeWavHeader(fileDescriptor, 0);
  dataBytes = 0;
  currentFilePath = resolvedPath;

  audioIO = new AudioIO({
    inOptions: {
      channelCount: CHANNEL_COUNT,
      sampleFormat: SampleFormat16Bit,
      sampleRate: SOURCE_SAMPLE_RATE,
      deviceId,
      sampleSource: 'loopback',
    },
  });

  audioIO.on('data', (chunk: Buffer) => {
    if (!fileDescriptor) {
      return;
    }

    const mono = interleavedToMono(chunk, CHANNEL_COUNT);
    const resampled = downsample(mono, SOURCE_SAMPLE_RATE, TARGET_SAMPLE_RATE);
    writeSamples(fileDescriptor, resampled);
  });

  audioIO.on('error', (error) => {
    console.error('Ошибка записи аудио:', error);
    stopAudioCapture();
  });

  try {
    audioIO.start();
  } catch (error) {
    console.error('Не удалось запустить поток аудио:', error);
    stopAudioCapture();
    throw error;
  }

  return resolvedPath;
}

export function stopAudioCapture(): string | null {
  if (!audioIO || fileDescriptor === null) {
    return null;
  }

  audioIO.quit();
  audioIO = null;

  const fd = fileDescriptor;
  fileDescriptor = null;

  writeWavHeader(fd, dataBytes);
  fs.closeSync(fd);

  const finishedPath = currentFilePath;
  currentFilePath = null;
  dataBytes = 0;

  return finishedPath;
}
