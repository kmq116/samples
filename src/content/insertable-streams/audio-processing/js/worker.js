/*
 *  Copyright (c) 2023 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

// Adjust this value to increase/decrease the amount of filtering.
// eslint-disable-next-line prefer-const
let cutoff = 100;


let backgroundMusic;
let musicOffset = 0;

function mixAudioWithBackgroundMusic() {
  const format = 'f32-planar';
  return (data, controller) => {
    // console.log(data);
    const nChannels = data.numberOfChannels;
    const buffer = new Float32Array(data.numberOfFrames * nChannels);

    for (let c = 0; c < nChannels; c++) {
      const offset = data.numberOfFrames * c;
      const samples = buffer.subarray(offset, offset + data.numberOfFrames);
      data.copyTo(samples, { planeIndex: c, format });
      // 优化：预先计算混合比例
      const micGain = 0.7;
      const musicGain = 0.3;
      // 混合背景音乐
      if (backgroundMusic) {
        const musicChannel = backgroundMusic.channelData[c % backgroundMusic.channelData.length];
        for (let i = 0; i < samples.length; i++) {
          const musicIndex = (musicOffset + i) % musicChannel.length;
          samples[i] = samples[i] * micGain + musicChannel[musicIndex] * musicGain;
        }
      }
    }

    // 更新音乐偏移
    if (backgroundMusic) {
      musicOffset = (musicOffset + data.numberOfFrames) % backgroundMusic.length;
    }

    controller.enqueue(new AudioData({
      format,
      sampleRate: data.sampleRate,
      numberOfFrames: data.numberOfFrames,
      numberOfChannels: nChannels,
      timestamp: data.timestamp,
      data: buffer
    }));
  };
}


// Returns a low-pass transform function for use with TransformStream.
function lowPassFilter() {
  const format = 'f32-planar';
  let lastValuePerChannel = undefined;
  return (data, controller) => {
    const rc = 1.0 / (cutoff * 2 * Math.PI);
    const dt = 1.0 / data.sampleRate;
    const alpha = dt / (rc + dt);
    const nChannels = data.numberOfChannels;
    if (!lastValuePerChannel) {
      console.log(`Audio stream has ${nChannels} channels.`);
      lastValuePerChannel = Array(nChannels).fill(0);
    }
    const buffer = new Float32Array(data.numberOfFrames * nChannels);
    for (let c = 0; c < nChannels; c++) {
      const offset = data.numberOfFrames * c;
      const samples = buffer.subarray(offset, offset + data.numberOfFrames);
      data.copyTo(samples, { planeIndex: c, format });
      const lastValue = lastValuePerChannel[c];

      // Apply low-pass filter to samples.
      // for (let i = 0; i < samples.length; ++i) {
      //   lastValue = lastValue + alpha * (samples[i] - lastValue);
      //   samples[i] = lastValue;
      // }

      lastValuePerChannel[c] = lastValue;
    }
    controller.enqueue(new AudioData({
      format,
      sampleRate: data.sampleRate,
      numberOfFrames: data.numberOfFrames,
      numberOfChannels: nChannels,
      timestamp: data.timestamp,
      data: buffer
    }));
  };
}

let abortController;

onmessage = async (event) => {
  console.warn(event.data);
  console.warn('event.data.command', event.data.command);
  if (event.data.command === 'decodeAudio') {
    const { sampleRate, channelData } = event.data;
    backgroundMusic = {
      sampleRate: sampleRate,
      channelData: channelData,
      length: channelData[0].length
    };
    console.log('Background music set in worker', backgroundMusic);
  } else if (event.data.command == 'abort') {
    console.log(2);
    abortController.abort();
    abortController = null;
  } else {
    console.log(3);
    const source = event.data.source;
    const sink = event.data.sink;
    const transformer = new TransformStream({ transform: mixAudioWithBackgroundMusic() });
    abortController = new AbortController();
    const signal = abortController.signal;
    console.log({ source });
    const promise = source.pipeThrough(transformer, { signal }).pipeTo(sink);
    promise.catch((e) => {
      if (signal.aborted) {
        console.log('Shutting down streams after abort.');
      } else {
        console.error('Error from stream transform:', e);
      }
      source.cancel(e);
      sink.abort(e);
    });
  }
};
