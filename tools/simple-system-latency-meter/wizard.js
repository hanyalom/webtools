const $ = (id) => document.getElementById(id);
const page = document.body;
const wizardSteps = [...document.querySelectorAll(".wizard-step")];
const history = ["welcome"];
const stepNames = {
  welcome: "Getting started",
  choice: "Choose your pace",
  measure: "Choose a measurement",
  "audio-setup": "Set up your microphone",
  "audio-record": "Record three clicks",
  "audio-review": "Listen to your recording",
  "audio-result": "Your result",
  "video-device": "Choose a camera",
  "video-record": "Record the mouse and screen",
  "video-finish": "Analyze your video"
};
const progressByStep = {
  welcome: 5,
  choice: 15,
  measure: 27,
  "audio-setup": 40,
  "audio-record": 58,
  "audio-review": 78,
  "audio-result": 100,
  "video-device": 40,
  "video-record": 65,
  "video-finish": 100
};

let currentStep = "welcome";
let selectedDevice = "";
let audioContext;
let micStream;
let micSource;
let recorderNode;
let silentGain;
let recording = false;
let sampleRate = 48000;
let audioChunks = [];
let rawSamples = new Float32Array();
let gatedSamples = new Float32Array();
let audioBlobUrl = "";
let clickCount = 0;
let isPressed = false;
let detectedEvents = [];
let gatePercent = 0;
let finishTimer = 0;

function showStep(id, { addHistory = true } = {}) {
  if (addHistory && history.at(-1) !== id) history.push(id);
  currentStep = id;
  wizardSteps.forEach((step) => {
    const active = step.dataset.step === id;
    step.hidden = !active;
    step.classList.toggle("is-active", active);
  });
  $("progress-fill").style.width = `${progressByStep[id] || 5}%`;
  $("step-count").textContent = stepNames[id] || "Guided measurement";
  page.classList.add("is-transitioning");
  window.setTimeout(() => page.classList.remove("is-transitioning"), 1200);
  if (id === "audio-review" || id === "audio-result") {
    requestAnimationFrame(() => {
      drawWaveform($("waveform"), detectedEvents);
      drawWaveform($("result-waveform"), detectedEvents);
    });
  }
}

function goBack() {
  if (history.length < 2) return;
  if (currentStep === "audio-record" && recording) abortRecording();
  history.pop();
  showStep(history.at(-1), { addHistory: false });
  if (currentStep === "audio-record" && !recording) {
    $("recording-progress").textContent = "Your last recording is ready. You can listen to it, or record again.";
    $("test-box").disabled = true;
    $("test-box-label").textContent = "Recording complete";
    $("record-again-button").hidden = false;
  }
}

document.querySelectorAll("[data-next]").forEach((button) => {
  button.addEventListener("click", () => showStep(button.dataset.next));
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", goBack);
});

function updateAudioSteps(activeIndex) {
  document.querySelectorAll("#click-steps li").forEach((step, index) => {
    step.classList.toggle("is-current", index === activeIndex);
    step.classList.toggle("is-done", index < activeIndex);
    const marker = step.querySelector(".step-check");
    marker.textContent = index < activeIndex ? "✓" : String(index + 1);
  });
}

function updateRecordPrompt() {
  const activeStep = clickCount * 2 + (isPressed ? 1 : 0);
  updateAudioSteps(activeStep);
  $("recording-progress").textContent = `Click ${Math.min(clickCount + 1, 3)} of 3 · ${isPressed ? "Keep holding until you hear the beep." : "Press and hold the mouse button to begin."}`;
  $("test-box-label").textContent = isPressed ? "Keep holding…" : "Press and hold for the beep";
}

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType) throw new Error("This browser does not support microphone recording.");
  audioContext = new AudioContextType({ latencyHint: "interactive" });
  return audioContext;
}

function clearAudioData() {
  if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
  audioBlobUrl = "";
  audioChunks = [];
  rawSamples = new Float32Array();
  gatedSamples = new Float32Array();
  detectedEvents = [];
  clickCount = 0;
  isPressed = false;
  clearTimeout(finishTimer);
}

async function startAudioRecording() {
  $("recording-error").hidden = true;
  $("recording-error-live").hidden = true;
  $("ready-button").disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires a secure connection (HTTPS) and a supported browser.");
    }
    const context = getAudioContext();
    await context.resume();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    });
    micSource = context.createMediaStreamSource(micStream);
    recorderNode = context.createScriptProcessor(2048, 1, 1);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    audioChunks = [];
    clickCount = 0;
    isPressed = false;
    sampleRate = context.sampleRate;
    recorderNode.onaudioprocess = (event) => {
      if (recording) audioChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    micSource.connect(recorderNode);
    recorderNode.connect(silentGain);
    silentGain.connect(context.destination);
    recording = true;
    $("ready-button").disabled = false;
    $("test-box").disabled = false;
    $("record-again-button").hidden = true;
    $("recording-progress").textContent = "Recording now. Press and hold the button below until you hear each beep.";
    $("test-box-label").textContent = "Press and hold for the beep";
    updateAudioSteps(0);
    showStep("audio-record");
  } catch (error) {
    abortRecording();
    $("recording-error").textContent = `We couldn’t start the microphone: ${error.message}`;
    $("recording-error").hidden = false;
    $("ready-button").disabled = false;
  }
}

$("ready-button").addEventListener("click", startAudioRecording);

function playBeep() {
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = 2500;
  gain.gain.value = 1;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.08);
}

function pointerDown(event) {
  if (!recording || isPressed || clickCount >= 3) return;
  event.preventDefault();
  isPressed = true;
  if (event.pointerId >= 0) $("test-box").setPointerCapture(event.pointerId);
  $("test-box").classList.add("is-pressed");
  try {
    playBeep();
    updateRecordPrompt();
  } catch (error) {
    $("recording-error-live").textContent = `The beep couldn’t play: ${error.message}`;
    $("recording-error-live").hidden = false;
    finishRecording();
  }
}

function pointerUp() {
  if (!recording || !isPressed) return;
  isPressed = false;
  $("test-box").classList.remove("is-pressed");
  clickCount += 1;
  if (clickCount < 3) {
    updateRecordPrompt();
    return;
  }
  updateAudioSteps(6);
  $("recording-progress").textContent = "All three clicks are done. Finishing your recording…";
  $("test-box-label").textContent = "All done — thank you!";
  $("test-box").disabled = true;
  finishTimer = window.setTimeout(finishRecording, 500);
}

const testBox = $("test-box");
testBox.addEventListener("pointerdown", pointerDown);
testBox.addEventListener("pointerup", pointerUp);
testBox.addEventListener("pointercancel", pointerUp);
testBox.addEventListener("lostpointercapture", pointerUp);
testBox.addEventListener("pointermove", () => {
  if (!isPressed && recording) {
    testBox.classList.add("is-moving");
    clearTimeout(testBox.moveTimer);
    testBox.moveTimer = window.setTimeout(() => testBox.classList.remove("is-moving"), 170);
  }
});
testBox.addEventListener("click", (event) => {
  if (event.detail !== 0 || !recording || isPressed) return;
  pointerDown({ preventDefault() {}, pointerId: -1 });
  window.setTimeout(pointerUp, 180);
});

function abortRecording() {
  recording = false;
  clearTimeout(finishTimer);
  if (recorderNode) {
    recorderNode.onaudioprocess = null;
    recorderNode.disconnect();
  }
  if (micSource) micSource.disconnect();
  if (silentGain) silentGain.disconnect();
  if (micStream) micStream.getTracks().forEach((track) => track.stop());
  recorderNode = null;
  micSource = null;
  silentGain = null;
  micStream = null;
  $("test-box").disabled = true;
  $("test-box").classList.remove("is-pressed");
  isPressed = false;
}

function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function finishRecording() {
  if (!recording) return;
  recording = false;
  if (recorderNode) {
    recorderNode.onaudioprocess = null;
    recorderNode.disconnect();
  }
  if (micSource) micSource.disconnect();
  if (silentGain) silentGain.disconnect();
  if (micStream) micStream.getTracks().forEach((track) => track.stop());

  const length = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!length) {
    $("recording-error-live").textContent = "No audio was captured. Please try recording again.";
    $("recording-error-live").hidden = false;
    $("test-box").disabled = true;
    return;
  }
  rawSamples = new Float32Array(length);
  let offset = 0;
  audioChunks.forEach((chunk) => {
    rawSamples.set(chunk, offset);
    offset += chunk.length;
  });
  audioChunks = [];
  audioBlobUrl = URL.createObjectURL(encodeWav(rawSamples, sampleRate));
  $("recording-player").src = audioBlobUrl;
  $("recording-player").load();
  const noise = autoZeroSound();
  gatedSamples = noise.data;
  gatePercent = noise.percent;
  $("noise-gate-value").textContent = `Zero sound below ${gatePercent.toFixed(1)}% of peak`;
  $("recording-progress").textContent = "Recording complete. Have a listen and check that you can hear both sounds.";
  $("test-box-label").textContent = "Recording complete";
  window.setTimeout(() => {
    showStep("audio-review");
    drawWaveform($("waveform"), []);
  }, 250);
}

function autoZeroSound() {
  const samplesPerMs = Math.max(1, Math.round(sampleRate / 1000));
  const binCount = Math.floor(rawSamples.length / samplesPerMs);
  if (!binCount) return { data: rawSamples, peak: 1, percent: 0 };
  let peak = 1e-6;
  for (let i = 0; i < rawSamples.length; i += 1) peak = Math.max(peak, Math.abs(rawSamples[i]));
  const peaks = new Float32Array(binCount);
  for (let bin = 0; bin < binCount; bin += 1) {
    const end = Math.min(rawSamples.length, (bin + 1) * samplesPerMs);
    for (let i = bin * samplesPerMs; i < end; i += 1) peaks[bin] = Math.max(peaks[bin], Math.abs(rawSamples[i]));
  }
  peaks.sort();
  const noise = peaks[Math.floor(binCount * 0.8)];
  const percent = Math.min(25, Math.ceil((noise * 1.5 / peak) * 1000) / 10);
  const threshold = percent / 100 * peak;
  const data = rawSamples.map((sample) => Math.abs(sample) < threshold ? 0 : sample);
  return { data, peak, percent };
}

function detectClicksAndBeeps(data, peak) {
  const samplesPerMs = Math.max(1, Math.round(sampleRate / 1000));
  const binCount = Math.floor(data.length / samplesPerMs);
  const beepLengthMs = 80;
  if (binCount < beepLengthMs + 2) return [];

  const envelope = new Float32Array(binCount);
  for (let bin = 0; bin < binCount; bin += 1) {
    let sum = 0;
    const end = Math.min(data.length, (bin + 1) * samplesPerMs);
    for (let i = bin * samplesPerMs; i < end; i += 1) sum += Math.abs(data[i]);
    envelope[bin] = sum / samplesPerMs;
  }
  const prefix = new Float64Array(binCount + 1);
  for (let bin = 0; bin < binCount; bin += 1) prefix[bin + 1] = prefix[bin] + envelope[bin];
  const averageBlock = (start) => (prefix[start + beepLengthMs] - prefix[start]) / beepLengthMs;
  let loudestBlock = 0;
  for (let bin = 0; bin <= binCount - beepLengthMs; bin += 1) loudestBlock = Math.max(loudestBlock, averageBlock(bin));

  const beeps = [];
  for (let bin = 0; bin <= binCount - beepLengthMs;) {
    if (averageBlock(bin) < loudestBlock * 0.5) {
      bin += 1;
      continue;
    }
    let bestStart = bin;
    for (let candidate = bin; candidate <= Math.min(binCount - beepLengthMs, bin + beepLengthMs); candidate += 1) {
      if (averageBlock(candidate) > averageBlock(bestStart)) bestStart = candidate;
    }
    const level = averageBlock(bestStart);
    let loudMs = 0;
    for (let i = bestStart; i < bestStart + beepLengthMs; i += 1) if (envelope[i] >= level * 0.5) loudMs += 1;
    if (loudMs >= beepLengthMs * 0.8) {
      let firstLoudMs = bestStart;
      while (firstLoudMs > 0 && envelope[firstLoudMs - 1] >= level * 0.5 && bestStart - firstLoudMs < beepLengthMs) firstLoudMs -= 1;
      let sample = Math.max(0, (firstLoudMs - 1) * samplesPerMs);
      const refinementEnd = Math.min(data.length, (firstLoudMs + 1) * samplesPerMs);
      while (sample < refinementEnd && Math.abs(data[sample]) < level * 0.8) sample += 1;
      beeps.push(sample);
    }
    bin = bestStart + beepLengthMs;
  }

  const threshold = peak * 0.15;
  const quietThreshold = threshold * 0.5;
  const spikeGap = Math.round(sampleRate * 0.005);
  const events = [];
  let previousBeepEnd = 0;
  beeps.slice(0, 3).forEach((beepStart) => {
    const searchStart = Math.max(previousBeepEnd, beepStart - sampleRate);
    const searchEnd = beepStart - samplesPerMs;
    let spikeStart = -1;
    let lastLoudSample = -1;
    for (let sample = searchStart; sample < searchEnd; sample += 1) {
      const value = Math.abs(data[sample]);
      if (value < quietThreshold) continue;
      if (spikeStart >= 0 && sample - lastLoudSample <= spikeGap) {
        lastLoudSample = sample;
        continue;
      }
      if (value < threshold) continue;
      spikeStart = sample;
      lastLoudSample = sample;
    }
    if (spikeStart >= 0) events.push({ type: "click", sample: spikeStart });
    events.push({ type: "beep", sample: beepStart });
    previousBeepEnd = beepStart + beepLengthMs * samplesPerMs;
  });
  return events;
}

function drawWaveform(canvas, events = []) {
  if (!canvas || !rawSamples.length) return;
  const scale = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
  }
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const styles = getComputedStyle(document.documentElement);
  const foreground = styles.getPropertyValue("--text").trim();
  const grid = styles.getPropertyValue("--line").trim();
  const wave = styles.getPropertyValue("--accent").trim();
  context.clearRect(0, 0, width, height);
  context.strokeStyle = grid;
  context.globalAlpha = 0.65;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  context.globalAlpha = 1;

  let peak = 1e-6;
  for (let i = 0; i < gatedSamples.length; i += 1) peak = Math.max(peak, Math.abs(gatedSamples[i]));
  const samplesPerPixel = rawSamples.length / width;
  context.strokeStyle = wave;
  context.fillStyle = wave;
  context.lineWidth = 1;
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor(x * samplesPerPixel);
    const end = Math.min(gatedSamples.length, Math.max(start + 1, Math.floor((x + 1) * samplesPerPixel)));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i += 1) {
      min = Math.min(min, gatedSamples[i]);
      max = Math.max(max, gatedSamples[i]);
    }
    const top = height / 2 - max / peak * (height * 0.42);
    const bottom = height / 2 - min / peak * (height * 0.42);
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
  context.font = "11px system-ui";
  context.textBaseline = "top";
  events.forEach((event) => {
    const x = event.sample / rawSamples.length * width;
    const color = event.type === "click" ? "#f59e0b" : "#df5c9b";
    context.strokeStyle = color;
    context.fillStyle = color;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    context.setLineDash([]);
    context.fillText(event.type, Math.min(x + 4, width - 40), 5);
  });
  context.fillStyle = foreground;
}

function analyzeRecording() {
  const analysisError = $("analysis-error");
  analysisError.hidden = true;
  const noise = autoZeroSound();
  gatedSamples = noise.data;
  gatePercent = noise.percent;
  detectedEvents = detectClicksAndBeeps(gatedSamples, noise.peak);
  const clicks = detectedEvents.filter((event) => event.type === "click");
  const beeps = detectedEvents.filter((event) => event.type === "beep");
  const pairs = [];
  for (let i = 0; i < Math.min(clicks.length, beeps.length); i += 1) {
    const latency = (beeps[i].sample - clicks[i].sample) / sampleRate * 1000;
    if (latency >= 0 && latency < 1000) pairs.push({ click: clicks[i], beep: beeps[i], latency });
  }
  if (!pairs.length) {
    analysisError.textContent = "We couldn’t confidently detect both sounds. Check your volume and microphone placement, then record again.";
    analysisError.hidden = false;
    return;
  }
  $("noise-gate-value").textContent = `Zero sound below ${gatePercent.toFixed(1)}% of peak`;
  $("latency-result").textContent = (pairs.reduce((sum, pair) => sum + pair.latency, 0) / pairs.length).toFixed(2);
  $("result-caption").textContent = `Average of ${pairs.length} detected ${pairs.length === 1 ? "attempt" : "attempts"}.`;
  $("result-rows").innerHTML = pairs.map((pair, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${(pair.click.sample / sampleRate * 1000).toFixed(2)} ms</td>
      <td>${(pair.beep.sample / sampleRate * 1000).toFixed(2)} ms</td>
      <td>${pair.latency.toFixed(2)} ms</td>
    </tr>`).join("");
  showStep("audio-result");
}

$("analyze-button").addEventListener("click", analyzeRecording);
$("retake-button").addEventListener("click", async () => {
  clearAudioData();
  $("recording-player").removeAttribute("src");
  $("recording-player").load();
  history.splice(history.indexOf("audio-review") + 1);
  showStep("audio-setup");
  await startAudioRecording();
});
$("record-again-button").addEventListener("click", async () => {
  clearAudioData();
  $("recording-player").removeAttribute("src");
  $("recording-player").load();
  showStep("audio-setup");
  await startAudioRecording();
});
$("start-over-button").addEventListener("click", () => window.location.reload());
$("guided-home-button").addEventListener("click", () => window.location.reload());

$("recording-player").addEventListener("timeupdate", () => {
  drawWaveform($("waveform"), detectedEvents);
  drawWaveform($("result-waveform"), detectedEvents);
});
window.addEventListener("resize", () => {
  drawWaveform($("waveform"), detectedEvents);
  drawWaveform($("result-waveform"), detectedEvents);
});
window.addEventListener("webtools-theme-change", () => {
  drawWaveform($("waveform"), detectedEvents);
  drawWaveform($("result-waveform"), detectedEvents);
});

document.querySelectorAll("[data-device]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedDevice = button.dataset.device;
    showStep("video-record");
  });
});

const videoTestBox = $("video-test-box");
let videoPointerDown = false;
const clearVideoMovement = () => {
  clearTimeout(videoTestBox.moveTimer);
  videoTestBox.classList.remove("is-moving");
};
videoTestBox.addEventListener("pointerdown", () => {
  videoPointerDown = true;
  clearVideoMovement();
  videoTestBox.classList.add("is-pressed");
});
videoTestBox.addEventListener("pointerup", () => {
  videoPointerDown = false;
  videoTestBox.classList.remove("is-pressed");
  clearVideoMovement();
});
videoTestBox.addEventListener("pointercancel", () => {
  videoPointerDown = false;
  videoTestBox.classList.remove("is-pressed");
  clearVideoMovement();
});
videoTestBox.addEventListener("pointerleave", clearVideoMovement);
videoTestBox.addEventListener("pointermove", () => {
  if (videoPointerDown) return;
  videoTestBox.classList.add("is-moving");
  clearTimeout(videoTestBox.moveTimer);
  videoTestBox.moveTimer = window.setTimeout(() => {
    videoTestBox.classList.remove("is-moving");
  }, 0);
});
$("video-done-button").addEventListener("click", () => {
  $("phone-finish").hidden = selectedDevice !== "phone";
  $("camera-finish").hidden = selectedDevice !== "camera";
  showStep("video-finish");
});

showStep("welcome", { addHistory: false });
