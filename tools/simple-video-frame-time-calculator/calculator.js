const $ = (id) => document.getElementById(id);
const fileInput = $("video-file");
const video = $("video-player");
let videoUrl = "";
let duration = 0;
let totalFrames = 0;
let currentFrame = 0;
let moveFrame = null;
let screenFrame = null;
let fileSelectionId = 0;
let detectedDetails = null;

function cleanFps(fps) {
  if (Math.abs(fps - 29.97) < 0.05) return 29.97;
  if (Math.abs(fps - 59.94) < 0.05) return 59.94;
  if (Math.abs(fps - 23.976) < 0.05) return 23.976;
  if (Math.abs(fps - Math.round(fps)) < 0.05) return Math.round(fps);
  return Math.round(fps * 1000) / 1000;
}

function getSlowMotionFactor(file) {
  const tail = file.slice(Math.max(0, file.size - 64 * 1024));
  return tail.text().then((text) => {
    const match = text.match(/"SPEED"\s*:\s*(\d+)/i) || text.match(/SlowMotion_Data\d+:\d+:(\d+)/i);
    if (!match) return null;
    const denominator = Number.parseInt(match[1], 10);
    return [2, 4, 8, 16, 32, 64].includes(denominator) ? 1 / denominator : null;
  }).catch((error) => {
    console.warn("Could not read optional slow-motion metadata:", error);
    return null;
  });
}

async function extractMp4Details(file) {
  try {
    const fileSize = file.size;
    let offset = 0;
    let moovBuffer = null;
    while (offset + 8 <= fileSize) {
      const header = await file.slice(offset, offset + 16).arrayBuffer();
      if (header.byteLength < 8) break;
      const view = new DataView(header);
      let size = view.getUint32(0);
      const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
      let headerSize = 8;
      if (size === 1) {
        if (header.byteLength < 16) break;
        size = Number(view.getBigUint64(8));
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }
      if (type === "moov") {
        moovBuffer = await file.slice(offset, offset + Math.min(size, 20 * 1024 * 1024)).arrayBuffer();
        break;
      }
      if (size <= 0 || size < headerSize) break;
      offset += size;
    }

    if (!moovBuffer) {
      const tailSize = Math.min(fileSize, 4 * 1024 * 1024);
      const tail = await file.slice(fileSize - tailSize).arrayBuffer();
      const tailView = new DataView(tail);
      for (let index = 0; index + 8 <= tail.byteLength; index += 1) {
        if (tailView.getUint32(index + 4) === 0x6d6f6f76) {
          moovBuffer = tail.slice(index);
          break;
        }
      }
    }
    if (!moovBuffer) return null;

    const view = new DataView(moovBuffer);
    function getBoxes(start, end) {
      const boxes = [];
      let position = start;
      while (position + 8 <= end) {
        let size = view.getUint32(position);
        const type = String.fromCharCode(view.getUint8(position + 4), view.getUint8(position + 5), view.getUint8(position + 6), view.getUint8(position + 7));
        let headerSize = 8;
        if (size === 1) {
          if (position + 16 > end) break;
          size = Number(view.getBigUint64(position + 8));
          headerSize = 16;
        } else if (size === 0) {
          size = end - position;
        }
        if (size < headerSize || position + size > end) break;
        boxes.push({ type, start: position + headerSize, end: position + size });
        position += size;
      }
      return boxes;
    }

    for (const trak of getBoxes(8, moovBuffer.byteLength).filter((box) => box.type === "trak")) {
      const mdia = getBoxes(trak.start, trak.end).find((box) => box.type === "mdia");
      if (!mdia) continue;
      const mdiaBoxes = getBoxes(mdia.start, mdia.end);
      const handler = mdiaBoxes.find((box) => box.type === "hdlr");
      if (!handler || handler.start + 12 > handler.end) continue;
      if (String.fromCharCode(...Array.from({ length: 4 }, (_, index) => view.getUint8(handler.start + 8 + index))) !== "vide") continue;

      const mdhd = mdiaBoxes.find((box) => box.type === "mdhd");
      const minf = mdiaBoxes.find((box) => box.type === "minf");
      if (!mdhd || !minf) continue;
      const timescale = view.getUint8(mdhd.start) === 1
        ? view.getUint32(mdhd.start + 20)
        : view.getUint32(mdhd.start + 12);
      const stbl = getBoxes(minf.start, minf.end).find((box) => box.type === "stbl");
      if (!stbl || timescale <= 0) continue;
      const tableBoxes = getBoxes(stbl.start, stbl.end);
      const stts = tableBoxes.find((box) => box.type === "stts");
      const stsz = tableBoxes.find((box) => box.type === "stsz");
      const totalFrames = stsz && stsz.start + 8 <= stsz.end ? view.getUint32(stsz.start + 8) : 0;
      if (!stts || stts.start + 8 > stts.end) continue;

      const entries = view.getUint32(stts.start + 4);
      const frequencies = new Map();
      let sampleCount = 0;
      let durationTicks = 0;
      for (let index = 0; index < entries && stts.start + 16 + index * 8 <= stts.end; index += 1) {
        const count = view.getUint32(stts.start + 8 + index * 8);
        const delta = view.getUint32(stts.start + 12 + index * 8);
        frequencies.set(delta, (frequencies.get(delta) || 0) + count);
        sampleCount += count;
        durationTicks += count * delta;
      }
      let dominantDelta = 0;
      let maxFrequency = 0;
      for (const [delta, count] of frequencies) {
        if (count > maxFrequency) {
          dominantDelta = delta;
          maxFrequency = count;
        }
      }
      const fps = dominantDelta > 0
        ? cleanFps(timescale / dominantDelta)
        : sampleCount > 0 && durationTicks > 0
          ? cleanFps(sampleCount * timescale / durationTicks)
          : null;
      return { fps, totalFrames, slowmo: await getSlowMotionFactor(file) };
    }
  } catch (error) {
    console.warn("MP4 video metadata parse warning:", error);
  }
  return null;
}

async function extractWebmDetails(file) {
  try {
    const buffer = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index + 8 <= bytes.length; index += 1) {
      if (bytes[index] !== 0x23 || bytes[index + 1] !== 0xe3 || bytes[index + 2] !== 0x83) continue;
      const length = bytes[index + 3] & 0x0f;
      let nanoseconds = 0;
      for (let part = 0; part < length && index + 4 + part < bytes.length; part += 1) {
        nanoseconds = nanoseconds * 256 + bytes[index + 4 + part];
      }
      const fps = 1_000_000_000 / nanoseconds;
      if (fps >= 1 && fps <= 1000) return { fps: cleanFps(fps) };
    }
  } catch (error) {
    console.warn("WebM video metadata parse warning:", error);
  }
  return null;
}

function getFpsFromCaptureStream() {
  try {
    if (typeof video.captureStream !== "function") return null;
    const [track] = video.captureStream().getVideoTracks();
    const fps = track?.getSettings().frameRate;
    return fps > 0 ? cleanFps(fps) : null;
  } catch {
    return null;
  }
}

function frameRate() {
  const value = Number.parseFloat($("fps-input").value);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function slowMotionSpeed() {
  return Number.parseFloat($("slowmo-speed").value);
}

function setMetadataStatus(element, text, detected = false) {
  element.textContent = text || "\u00a0";
  element.classList.toggle("is-detected", detected);
}

function updateFrameDisplay() {
  const fps = frameRate();
  currentFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame));
  $("frame-number").textContent = String(currentFrame);
  $("time-display").textContent = `${video.currentTime.toFixed(3)} s`;
  $("frame-slider").value = String(currentFrame);
  updateMarkers();
}

function seekFrame(frame) {
  if (!totalFrames) return;
  currentFrame = Math.max(0, Math.min(totalFrames - 1, frame));
  const targetTime = Math.min(duration, (currentFrame + 0.5) / frameRate());
  video.currentTime = targetTime;
  updateFrameDisplay();
}

function updateMarkers() {
  $("move-status").innerHTML = `<span class="marker-dot move-dot"></span>Mouse movement: ${moveFrame === null ? "not marked" : `frame ${moveFrame}`}`;
  $("screen-status").innerHTML = `<span class="marker-dot screen-dot"></span>Screen response: ${screenFrame === null ? "not marked" : `frame ${screenFrame}`}`;
  $("set-move").disabled = !totalFrames;
  $("set-screen").disabled = !totalFrames;
  $("reset-markers").disabled = moveFrame === null && screenFrame === null;
  if (moveFrame !== null && screenFrame !== null) {
    const latency = (screenFrame - moveFrame) / frameRate() * slowMotionSpeed() * 1000;
    $("measurement-result").hidden = latency < 0;
    if (latency >= 0) $("latency-value").textContent = latency.toFixed(2);
    $("video-error").textContent = latency < 0 ? "The screen response is marked before the mouse movement. Step to a later frame and set the screen response again." : "";
    $("video-error").hidden = latency >= 0;
    $("calculator-progress").style.width = "100%";
    $("calculator-status").textContent = "Measurement complete";
  } else {
    $("measurement-result").hidden = true;
    $("calculator-progress").style.width = moveFrame === null ? "24%" : "68%";
    $("calculator-status").textContent = moveFrame === null ? "Mark when the mouse moves" : "Now mark when the screen responds";
  }
}

async function openVideo(file) {
  $("upload-error").hidden = true;
  $("video-error").hidden = true;
  if (!file || (!file.type.startsWith("video/") && !/\.(mp4|m4v|mov|webm|mkv|avi|wmv|3gp)$/i.test(file.name))) {
    $("upload-error").textContent = "Please choose a video file to continue.";
    $("upload-error").hidden = false;
    return;
  }
  const selectionId = ++fileSelectionId;
  $("calculator-status").textContent = "Detecting video settings…";
  setMetadataStatus($("metadata-status"), "Detecting frame rate…");
  setMetadataStatus($("slowmo-metadata-status"), "Detecting slow-motion speed…");
  detectedDetails = await extractMp4Details(file);
  if (!detectedDetails) detectedDetails = await extractWebmDetails(file);
  if (selectionId !== fileSelectionId) return;

  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  video._detectedDetails = detectedDetails;
  video.src = videoUrl;
  video.load();
  $("video-name").textContent = file.name;
}

fileInput.addEventListener("change", () => openVideo(fileInput.files[0]));
$("replace-video-file").addEventListener("change", (event) => openVideo(event.target.files[0]));

const uploadBox = $("upload-box");
uploadBox.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadBox.classList.add("is-dragging");
});
uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("is-dragging"));
uploadBox.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadBox.classList.remove("is-dragging");
  openVideo(event.dataTransfer.files[0]);
});

video.addEventListener("loadedmetadata", () => {
  duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    $("upload-error").textContent = "This video doesn’t have readable duration information. Try the full video calculator for additional format support.";
    $("upload-error").hidden = false;
    return;
  }
  const embeddedFps = video._detectedDetails?.fps;
  const streamFps = embeddedFps ? null : getFpsFromCaptureStream();
  const detectedFps = embeddedFps || streamFps;
  if (detectedFps > 0) {
    $("fps-input").value = String(detectedFps);
    setMetadataStatus(
      $("metadata-status"),
      video._detectedDetails?.fps
        ? `Auto-detected from video details: ${detectedFps} fps`
        : `Auto-detected from video stream: ${detectedFps} fps`,
      true
    );
  } else {
    $("fps-input").value = "30";
    setMetadataStatus($("metadata-status"), "Frame rate not found; using the 30 fps default");
  }
  const fps = frameRate();
  totalFrames = video._detectedDetails?.totalFrames > 0
    ? video._detectedDetails.totalFrames
    : Math.max(1, Math.round(duration * fps));
  const detectedSlowmo = video._detectedDetails?.slowmo;
  $("slowmo-speed").value = String(detectedSlowmo || 1);
  setMetadataStatus(
    $("slowmo-metadata-status"),
    detectedSlowmo ? `Auto-detected from video details: 1/${1 / detectedSlowmo} speed` : "No slow-motion tag detected",
    Boolean(detectedSlowmo)
  );
  currentFrame = 0;
  moveFrame = null;
  screenFrame = null;
  $("frame-slider").max = String(totalFrames - 1);
  $("calculator-intro").hidden = true;
  $("video-workspace").hidden = false;
  $("calculator-progress").style.width = "24%";
  $("calculator-status").textContent = "Mark when the mouse moves";
  video.currentTime = 0;
  updateFrameDisplay();
});

video.addEventListener("error", () => {
  const message = video.error?.message || "This browser couldn’t open the video. Try MP4 or WebM, or use the full video calculator.";
  if ($("video-workspace").hidden) {
    $("upload-error").textContent = message;
    $("upload-error").hidden = false;
  } else {
    $("video-error").textContent = message;
    $("video-error").hidden = false;
  }
});

video.addEventListener("timeupdate", () => {
  if (!totalFrames) return;
  currentFrame = Math.max(0, Math.min(totalFrames - 1, Math.floor(video.currentTime * frameRate())));
  updateFrameDisplay();
});

$("fps-input").addEventListener("change", () => {
  if (!Number.isFinite(Number.parseFloat($("fps-input").value)) || Number.parseFloat($("fps-input").value) <= 0) {
    $("fps-input").value = "30";
  }
  setMetadataStatus($("metadata-status"), "Manually adjusted");
  if (!duration) return;
  totalFrames = Math.max(1, Math.ceil(duration * frameRate()));
  $("frame-slider").max = String(totalFrames - 1);
  seekFrame(Math.floor(video.currentTime * frameRate()));
  updateMarkers();
});
$("slowmo-speed").addEventListener("change", () => {
  setMetadataStatus($("slowmo-metadata-status"), "Manually adjusted");
  updateMarkers();
});

$("previous-frame").addEventListener("click", () => seekFrame(currentFrame - 1));
$("next-frame").addEventListener("click", () => seekFrame(currentFrame + 1));
$("frame-slider").addEventListener("input", (event) => seekFrame(Number.parseInt(event.target.value, 10)));
$("set-move").addEventListener("click", () => {
  moveFrame = currentFrame;
  updateMarkers();
});
$("set-screen").addEventListener("click", () => {
  screenFrame = currentFrame;
  updateMarkers();
});
$("reset-markers").addEventListener("click", () => {
  moveFrame = null;
  screenFrame = null;
  updateMarkers();
});

window.addEventListener("keydown", (event) => {
  if (["INPUT", "VIDEO", "BUTTON", "A"].includes(document.activeElement.tagName)) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    seekFrame(currentFrame - (event.shiftKey ? 10 : 1));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    seekFrame(currentFrame + (event.shiftKey ? 10 : 1));
  }
});
