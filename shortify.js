const { exec, spawn } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    inputVideo: null,
    zoomLevel: 100,
    endHold: 0,
    startHold: 0,
    fadeOutDuration: 0.5,
    background: 'B', // Default to black background
    slideOverrides: {} // Store slide-specific overrides
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '-i':
      case '--input':
        config.inputVideo = args[++i];
        break;
      case '-z':
      case '--zoom':
        config.zoomLevel = parseFloat(args[++i]);
        break;
      case '-eh':
      case '--end-hold':
        config.endHold = parseFloat(args[++i]);
        break;
      case '-sh':
      case '--start-hold':
        config.startHold = parseFloat(args[++i]);
        break;
      case '-fo':
      case '--fade-out':
        config.fadeOutDuration = parseFloat(args[++i]);
        break;
      case '-bg':
      case '--background':
        config.background = args[++i].toUpperCase();
        break;
      case '-h':
      case '--help':
        showHelp();
        process.exit(0);
        break;
      default:
        // Check for slide-specific overrides (e.g., -z1, -sh3, -eh2)
        if (arg.startsWith('-z') && /^-z\d+$/.test(arg)) {
          const slideNum = parseInt(arg.substring(2));
          const value = parseFloat(args[++i]);
          if (!config.slideOverrides[slideNum]) config.slideOverrides[slideNum] = {};
          config.slideOverrides[slideNum].zoom = value;
        } else if (arg.startsWith('-sh') && /^-sh\d+$/.test(arg)) {
          const slideNum = parseInt(arg.substring(3));
          const value = parseFloat(args[++i]);
          if (!config.slideOverrides[slideNum]) config.slideOverrides[slideNum] = {};
          config.slideOverrides[slideNum].startHold = value;
        } else if (arg.startsWith('-eh') && /^-eh\d+$/.test(arg)) {
          const slideNum = parseInt(arg.substring(3));
          const value = parseFloat(args[++i]);
          if (!config.slideOverrides[slideNum]) config.slideOverrides[slideNum] = {};
          config.slideOverrides[slideNum].endHold = value;
        } else if (arg.startsWith('-bg') && /^-bg\d+$/.test(arg)) {
          const slideNum = parseInt(arg.substring(3));
          const value = args[++i].toUpperCase();
          if (!config.slideOverrides[slideNum]) config.slideOverrides[slideNum] = {};
          config.slideOverrides[slideNum].background = value;
        } else if (arg.startsWith('-')) {
          console.error(`Unknown flag: ${arg}`);
          showHelp();
          process.exit(1);
        }
        break;
    }
  }

  return config;
}

function showHelp() {
  console.log("Usage: node shortify.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  -i, --input <file>     Input video file (required)");
  console.log("  -z, --zoom <level>     Zoom level as percentage (default: 100)");
  console.log("                        100 = 100% match, 50 = 50% zoom out, 150 = 150% zoom in");
  console.log("  -eh, --end-hold <sec>  Seconds to hold last frame at final position (default: 0)");
  console.log("  -sh, --start-hold <sec> Seconds to hold first frame at start position (default: 0)");
  console.log("  -fo, --fade-out <sec> Audio fade-out duration at end of video (default: 0.5)");
  console.log("  -bg, --background <W|B> Background color: W=white, B=black (default: B)");
  console.log("  -h, --help            Show this help message");
  console.log("");
  console.log("Slide-specific overrides (use slide number after flag):");
  console.log("  -z<num> <level>       Override zoom level for specific slide (e.g., -z1 75)");
  console.log("  -sh<num> <sec>        Override start hold for specific slide (e.g., -sh3 1)");
  console.log("  -eh<num> <sec>        Override end hold for specific slide (e.g., -eh2 2)");
  console.log("  -bg<num> <W|B>        Override background for specific slide (e.g., -bg1 W)");
  console.log("");
  console.log("Examples:");
  console.log("  node shortify.js -i video.mp4");
  console.log("  node shortify.js -i video.mp4 -z 75 -eh 3");
  console.log("  node shortify.js -i video.mp4 -fo 1.25");
  console.log("  node shortify.js -i video.mp4 -z 50 -bg W");
  console.log("  node shortify.js -i video.mp4 -sh 2 -eh 3");
  console.log("  node shortify.js -i video.mp4 -z1 75 -sh3 1 -eh2 2");
}

// Parse and validate arguments
const config = parseArguments();

if (!config.inputVideo) {
  console.error("Error: Input video file is required");
  showHelp();
  process.exit(1);
}

if (config.zoomLevel <= 0 || config.zoomLevel > 200) {
  console.error("Error: zoomLevel must be between 1 and 200 (percentage)");
  process.exit(1);
}

if (config.endHold < 0) {
  console.error("Error: endHold must be a positive number or zero");
  process.exit(1);
}

if (config.startHold < 0) {
  console.error("Error: startHold must be a positive number or zero");
  process.exit(1);
}

if (isNaN(config.fadeOutDuration) || config.fadeOutDuration < 0) {
  console.error("Error: fadeOutDuration must be a positive number or zero");
  process.exit(1);
}

if (!['W', 'B'].includes(config.background)) {
  console.error("Error: background must be 'W' (white) or 'B' (black)");
  process.exit(1);
}

// Validate slide overrides
for (const [slideNum, overrides] of Object.entries(config.slideOverrides)) {
  const num = parseInt(slideNum);
  if (num < 1) {
    console.error(`Error: Slide number must be 1 or greater (got ${num})`);
    process.exit(1);
  }
  
  if (overrides.zoom && (overrides.zoom <= 0 || overrides.zoom > 200)) {
    console.error(`Error: Slide ${num} zoom level must be between 1 and 200 (got ${overrides.zoom})`);
    process.exit(1);
  }
  
  if (overrides.startHold && overrides.startHold < 0) {
    console.error(`Error: Slide ${num} start hold must be positive or zero (got ${overrides.startHold})`);
    process.exit(1);
  }
  
  if (overrides.endHold && overrides.endHold < 0) {
    console.error(`Error: Slide ${num} end hold must be positive or zero (got ${overrides.endHold})`);
    process.exit(1);
  }
  
  if (overrides.background && !['W', 'B'].includes(overrides.background)) {
    console.error(`Error: Slide ${num} background must be 'W' (white) or 'B' (black) (got ${overrides.background})`);
    process.exit(1);
  }
}

// Set variables for backward compatibility
const inputVideo = config.inputVideo;
const holdDuration = config.endHold;
const startHold = config.startHold;
const zoomLevel = config.zoomLevel;
const backgroundColor = config.background;
const slideOverrides = config.slideOverrides;
const fadeOutDuration = config.fadeOutDuration;

// Constants
const TEMP_DIR = `temp_shortify_${Date.now()}`;
const OUTPUT_FILE = "_shorted.mp4";
const FRAME_RATE = 60;

// Helper function for logging with timestamps
function logWithTimestamp(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Helper to extract scene-change timestamps via showinfo (reads stderr, no shell redirection)
async function extractSceneTimestampsFromShowinfo(video, threshold) {
  const cmd = `ffmpeg -hide_banner -loglevel info -nostats -i "${video}" -vf "select='if(eq(n,0),1,gt(scene,${threshold}))',showinfo" -f null -`;
  const { stderr } = await execPromise(cmd);
  const timestamps = [];
  const lines = stderr.split('\n');
  for (const line of lines) {
    const m = line.match(/pts_time:([\d\.]+)/);
    if (m) {
      const t = parseFloat(m[1]);
      if (!isNaN(t)) timestamps.push(t);
    }
  }
  return timestamps;
}

// Helper function for executing FFmpeg commands
async function safeExec(command, stepDescription) {
  try {
    logWithTimestamp(`Starting: ${stepDescription}`);
    await execPromise(command);
    logWithTimestamp(`Completed: ${stepDescription}`);
  } catch (error) {
    console.error(`Failed during: ${stepDescription}\nCommand: ${command}\nError: ${error.message}`);
    process.exit(1);
  }
}

// Function to get video dimensions and duration
async function getVideoInfo(video) {
  // Get video width
  const { stdout: width } = await execPromise(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "${video}"`
  );
  
  // Get video height
  const { stdout: height } = await execPromise(
    `ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "${video}"`
  );
  
  // Get video duration
  const { stdout: duration } = await execPromise(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${video}"`
  );
  
  return {
    width: parseInt(width.trim()),
    height: parseInt(height.trim()),
    duration: parseFloat(duration.trim())
  };
}

// Function to get video time base (num/den)
async function getVideoTimeBase(video) {
  const { stdout: timeBase } = await execPromise(
    `ffprobe -v error -select_streams v:0 -show_entries stream=time_base -of default=noprint_wrappers=1:nokey=1 "${video}"`
  );
  const tb = timeBase.trim();
  const [numStr, denStr] = tb.split("/");
  const num = parseInt(numStr, 10);
  const den = parseInt(denStr, 10);
  return { num, den };
}

// Function to extract still frames using scene detection and capture timestamps
async function extractStills(inputVideo) {
  const stillsDir = path.join(TEMP_DIR, 'stills');
  
  // Create temporary directory
  await fs.promises.mkdir(stillsDir, { recursive: true });
  
  let timestamps = [];
  let usedRegularIntervals = false;
  
  try {
    // Extract frames with scene detection and write filenames with sequential index
    logWithTimestamp("Extracting frames with scene detection...");
    await safeExec(
      `ffmpeg -hide_banner -loglevel error -i "${inputVideo}" -vf "select='if(eq(n,0),1,gt(scene,0.01))'" -vsync vfr "${stillsDir}/frame_%d.png"`,
      "Extracting frames with scene detection"
    );

    // Independently extract timestamps via showinfo (stderr parsed directly)
    const sceneTimestamps = await extractSceneTimestampsFromShowinfo(inputVideo, 0.01);
    if (sceneTimestamps.length > 0) {
      timestamps = sceneTimestamps;
      logWithTimestamp(`Captured ${timestamps.length} timestamps via showinfo.`);
    } else {
      logWithTimestamp("No timestamps from showinfo; will fallback later if needed.");
    }
  } catch (error) {
    logWithTimestamp("Scene detection failed, trying regular intervals");
    usedRegularIntervals = true;
  }
  
  // Get list of extracted frames
  let files = await fs.promises.readdir(stillsDir);
  let frameFiles = files
    .filter(file => file.startsWith('frame_') && file.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/frame_(\d+)\.png/)[1]);
      const numB = parseInt(b.match(/frame_(\d+)\.png/)[1]);
      return numA - numB;
    });
  
  // If scene detection didn't find enough frames, extract frames at regular intervals
  if (frameFiles.length < 2) {
    logWithTimestamp("Scene detection found too few frames, extracting at regular intervals instead");
    usedRegularIntervals = true;
    
    // Clear existing frames
    for (const file of frameFiles) {
      await fs.promises.unlink(path.join(stillsDir, file));
    }
    
    // Extract frames every 2 seconds
    await safeExec(
      `ffmpeg -hide_banner -loglevel error -i "${inputVideo}" -vf "fps=0.5" -frame_pts 1 "${stillsDir}/frame_%d.png"`,
      "Extracting frames at regular intervals"
    );
    
    // Get the new frame list
    files = await fs.promises.readdir(stillsDir);
    frameFiles = files
      .filter(file => file.startsWith('frame_') && file.endsWith('.png'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/frame_(\d+)\.png/)[1]);
        const numB = parseInt(b.match(/frame_(\d+)\.png/)[1]);
        return numA - numB;
      });
  }
  
  // If showinfo didn't yield timestamps, fallback to evenly distributing across duration
  if (timestamps.length === 0 && frameFiles.length > 0) {
    const videoInfo = await getVideoInfo(inputVideo);
    const interval = videoInfo.duration / frameFiles.length;
    timestamps = Array.from({ length: frameFiles.length }, (_, i) => i * interval);
    logWithTimestamp(`Fallback timestamps (even distribution): ${timestamps.map(t=>t.toFixed(2)).join(', ')}`);
  }

  logWithTimestamp(`Extracted ${frameFiles.length} still frames`);
  return { stillsDir, frameFiles, usedRegularIntervals, timestamps };
}

// Function to get frame timestamps that match exactly how we extracted the frames
async function getFrameTimestamps(inputVideo, frameCount, usedRegularIntervals) {
  const videoInfo = await getVideoInfo(inputVideo);
  const timestamps = [];
  
  if (usedRegularIntervals) {
    // If we used regular intervals for frame extraction, use the same for timestamps
    logWithTimestamp("Using regular intervals for timestamps to match frame extraction");
    const interval = videoInfo.duration / frameCount;
    for (let i = 0; i < frameCount; i++) {
      timestamps.push(interval * i);
    }
  } else {
    // If we used scene detection for frames, try to get the actual timestamps
    try {
      logWithTimestamp("Attempting to extract scene detection timestamps...");
      const { stderr } = await execPromise(
        `ffmpeg -i "${inputVideo}" -vf "select='if(eq(n,0),1,gt(scene,0.01))',showinfo" -f null - 2>&1`
      );
      
      // Parse the stderr output to extract timestamps
      const lines = stderr.split('\n');
      for (const line of lines) {
        const match = line.match(/n:\s*(\d+).*pts_time:([\d.]+)/);
        if (match) {
          timestamps.push(parseFloat(match[2]));
        }
      }
      
      // If we didn't get enough timestamps, fall back to regular intervals
      if (timestamps.length < frameCount) {
        logWithTimestamp(`Scene detection found ${timestamps.length} timestamps, using regular intervals`);
        timestamps.length = 0;
        const interval = videoInfo.duration / frameCount;
        for (let i = 0; i < frameCount; i++) {
          timestamps.push(interval * i);
        }
      }
      
    } catch (error) {
      logWithTimestamp("Failed to extract scene timestamps, using regular intervals");
      const interval = videoInfo.duration / frameCount;
      for (let i = 0; i < frameCount; i++) {
        timestamps.push(interval * i);
      }
    }
  }
  
  logWithTimestamp(`Final timestamps: ${timestamps.map(t => t.toFixed(2)).join(', ')}`);
  return timestamps;
}

// Function to create panning video from still frames
async function createPanningVideo(stillsDir, frameFiles, timestamps, videoInfo) {
  const outputVideo = path.join(TEMP_DIR, 'panning_video.mp4');
  
  // Calculate panning parameters based on input resolution
  const landscapeWidth = videoInfo.width;
  const landscapeHeight = videoInfo.height;
  
  // Detect if input is 4K or 1080p and set output accordingly
  let portraitHeight, portraitWidth;
  if (landscapeHeight >= 2160) {
    // 4K input -> 4K portrait (2160x3840)
    portraitHeight = 3840;
    portraitWidth = 2160;
    logWithTimestamp("Detected 4K input, outputting 4K portrait (2160x3840)");
  } else {
    // 1080p or lower -> 1080p portrait (608x1080)
    portraitHeight = 1080;
    portraitWidth = 608;
    logWithTimestamp("Detected 1080p or lower input, outputting 1080p portrait (608x1080)");
  }
  
  // Scale factor to fit landscape height to portrait height
  const baseScaleFactor = portraitHeight / landscapeHeight;
  
  // Apply zoom level (100 = 100% match, 50 = 50% zoom out, etc.)
  const zoomFactor = zoomLevel / 100;
  const scaleFactor = baseScaleFactor * zoomFactor;
  
  // Calculate final dimensions after zoom
  const finalScaleHeight = Math.round(landscapeHeight * scaleFactor);
  const finalScaleWidth = Math.round(landscapeWidth * scaleFactor);
  
  // For zoom out, we want to see more content, so we need a larger canvas
  // The canvas should be large enough to show the zoomed content plus some extra
  const canvasWidth = Math.max(portraitWidth, finalScaleWidth + 200); // Extra 200px for panning
  const canvasHeight = Math.max(portraitHeight, finalScaleHeight + 200); // Extra 200px for panning
  
  // Pan distance (how much we need to pan from left to right)
  // This should be the difference between the canvas width and portrait width
  const panDistance = Math.max(0, canvasWidth - portraitWidth);
  
  logWithTimestamp(`Panning parameters: input=${landscapeWidth}x${landscapeHeight}, output=${portraitWidth}x${portraitHeight}`);
  logWithTimestamp(`Zoom: ${zoomLevel}% (scale=${scaleFactor.toFixed(3)}), scaled=${finalScaleWidth}x${finalScaleHeight}, canvas=${canvasWidth}x${canvasHeight}`);
  logWithTimestamp(`Pan distance: ${panDistance.toFixed(0)}px`);
  if (startHold > 0) {
    logWithTimestamp(`First frame hold: will hold at start position for ${startHold}s before panning`);
  }
  if (holdDuration > 0) {
    logWithTimestamp(`Last frame hold: will complete pan ${holdDuration}s early and hold at final position`);
  }
  
  // Log slide overrides
  for (const [slideNum, overrides] of Object.entries(slideOverrides)) {
    const overridesList = [];
    if (overrides.zoom) overridesList.push(`zoom=${overrides.zoom}%`);
    if (overrides.startHold) overridesList.push(`startHold=${overrides.startHold}s`);
    if (overrides.endHold) overridesList.push(`endHold=${overrides.endHold}s`);
    if (overrides.background) overridesList.push(`background=${overrides.background}`);
    logWithTimestamp(`Slide ${slideNum} overrides: ${overridesList.join(', ')}`);
  }
  
  // Helper function to get slide-specific values and calculate dimensions
  function getSlideConfig(slideIndex) {
    const slideNum = slideIndex + 1; // Convert 0-based to 1-based
    const overrides = slideOverrides[slideNum] || {};
    
    const slideZoom = overrides.zoom !== undefined ? overrides.zoom : zoomLevel;
    const slideStartHold = overrides.startHold !== undefined ? overrides.startHold : startHold;
    const slideEndHold = overrides.endHold !== undefined ? overrides.endHold : 0; // Default to 0, not holdDuration
    const slideBackground = overrides.background !== undefined ? overrides.background : backgroundColor;
    
    // Calculate slide-specific dimensions using the base scale factor (portraitHeight / landscapeHeight)
    const baseScaleFactor = portraitHeight / landscapeHeight;
    const slideScaleFactor = baseScaleFactor * (slideZoom / 100);
    const slideFinalScaleHeight = Math.round(landscapeHeight * slideScaleFactor);
    const slideFinalScaleWidth = Math.round(landscapeWidth * slideScaleFactor);
    
    // For 100% zoom, don't add padding - scale directly to portrait dimensions
    // For other zoom levels, add padding but don't exceed portrait dimensions
    let slideCanvasWidth, slideCanvasHeight;
    if (slideZoom === 100) {
      slideCanvasWidth = slideFinalScaleWidth;
      slideCanvasHeight = slideFinalScaleHeight;
    } else {
      slideCanvasWidth = Math.max(portraitWidth, slideFinalScaleWidth + 200);
      slideCanvasHeight = Math.min(portraitHeight, Math.max(portraitHeight, slideFinalScaleHeight + 200));
    }
    
    const slidePanDistance = Math.max(0, slideCanvasWidth - portraitWidth);
    
    return {
      zoom: slideZoom,
      startHold: slideStartHold,
      endHold: slideEndHold,
      background: slideBackground,
      scaleFactor: slideScaleFactor,
      finalScaleHeight: slideFinalScaleHeight,
      finalScaleWidth: slideFinalScaleWidth,
      canvasWidth: slideCanvasWidth,
      canvasHeight: slideCanvasHeight,
      panDistance: slidePanDistance
    };
  }

  // Create filter complex for each frame with panning
  let filterComplex = '';
  let inputs = '';
  
  for (let i = 0; i < frameFiles.length; i++) {
    const frameFile = path.join(stillsDir, frameFiles[i]);
    
    // Get slide-specific configuration
    const slideConfig = getSlideConfig(i);
    
    // Debug logging for each slide
    logWithTimestamp(`Slide ${i + 1}: zoom=${slideConfig.zoom}%, scale=${slideConfig.scaleFactor.toFixed(3)}, scaled=${slideConfig.finalScaleWidth}x${slideConfig.finalScaleHeight}, canvas=${slideConfig.canvasWidth}x${slideConfig.canvasHeight}, pan=${slideConfig.panDistance}px`);
    
    // Calculate duration for this frame segment
    let duration;
    let panExpression;
    
    // Calculate duration for this frame segment
    if (i < timestamps.length - 1) {
      duration = timestamps[i + 1] - timestamps[i];
    } else {
      duration = videoInfo.duration - timestamps[i];
    }
    
    // Check for start hold (applies to any slide with start hold override, or first slide with global start hold)
    const hasStartHold = slideConfig.startHold > 0 || (i === 0 && startHold > 0);
    const startHoldDuration = slideConfig.startHold > 0 ? slideConfig.startHold : (i === 0 ? startHold : 0);
    
    // Check for end hold (applies to any slide with end hold override, or last slide with global end hold)
    const hasEndHold = slideConfig.endHold > 0 || (i === timestamps.length - 1 && holdDuration > 0);
    const endHoldDuration = slideConfig.endHold > 0 ? slideConfig.endHold : (i === timestamps.length - 1 ? holdDuration : 0);
    
    
    // Validate hold durations
    if (hasStartHold && startHoldDuration >= duration) {
      console.error(`Error: start hold duration (${startHoldDuration}s) exceeded the duration of slide ${i + 1} (${duration.toFixed(1)}s)`);
      process.exit(1);
    }
    
    if (hasEndHold && endHoldDuration >= duration) {
      console.error(`Error: end hold duration (${endHoldDuration}s) exceeded the duration of slide ${i + 1} (${duration.toFixed(1)}s)`);
      process.exit(1);
    }
    
    // Calculate pan expression based on holds
    if (hasStartHold && hasEndHold) {
      // Both start and end hold
      const panTime = duration - startHoldDuration - endHoldDuration;
      panExpression = `max(0, min(${slideConfig.panDistance}, ${slideConfig.panDistance}*(t-${startHoldDuration})/${panTime}))`;
      logWithTimestamp(`Slide ${i + 1}: holding for ${startHoldDuration.toFixed(1)}s, panning for ${panTime.toFixed(1)}s, then holding for ${endHoldDuration.toFixed(1)}s`);
    } else if (hasStartHold) {
      // Start hold only
      const panTime = duration - startHoldDuration;
      panExpression = `max(0, ${slideConfig.panDistance}*(t-${startHoldDuration})/${panTime})`;
      logWithTimestamp(`Slide ${i + 1}: holding for ${startHoldDuration.toFixed(1)}s, then panning for ${panTime.toFixed(1)}s`);
    } else if (hasEndHold) {
      // End hold only
      const panTime = duration - endHoldDuration;
      panExpression = `min(${slideConfig.panDistance}, ${slideConfig.panDistance}*t/${panTime})`;
      logWithTimestamp(`Slide ${i + 1}: panning for ${panTime.toFixed(1)}s, then holding for ${endHoldDuration.toFixed(1)}s`);
    } else {
      // Normal panning
      panExpression = `${slideConfig.panDistance}*t/${duration}`;
    }
    
    inputs += `-loop 1 -t ${duration} -i "${frameFile}" `;
    
    // Use the slide-specific background color
    const bgColor = slideConfig.background === 'W' ? 'white' : 'black';
    
    if (slideConfig.zoom === 100) {
      // For 100% zoom, scale directly and crop (no padding needed)
      logWithTimestamp(`Slide ${i + 1}: 100% zoom, direct scale and crop`);
      filterComplex += `[${i}:v]fps=${FRAME_RATE},scale=${slideConfig.finalScaleWidth}:${slideConfig.finalScaleHeight},crop=${portraitWidth}:${portraitHeight}:'${panExpression}':0,setpts=PTS-STARTPTS[v${i}];`;
    } else {
      // For other zoom levels, pad to canvas size, then crop
      const canvasHorizontalOffset = Math.round((slideConfig.canvasWidth - slideConfig.finalScaleWidth) / 2);
      const canvasVerticalOffset = Math.round((slideConfig.canvasHeight - slideConfig.finalScaleHeight) / 2);
      
      logWithTimestamp(`Slide ${i + 1}: canvas offsets = ${canvasHorizontalOffset}x${canvasVerticalOffset}`);
      
      // For zoom levels > 100%, we need to adjust the vertical crop position to center the content
      let verticalCropOffset = 0;
      if (slideConfig.zoom > 100) {
        // When zoomed in, center the crop vertically instead of cropping from top
        verticalCropOffset = Math.round((slideConfig.finalScaleHeight - portraitHeight) / 2);
        logWithTimestamp(`Slide ${i + 1}: zoomed in, vertical offset = ${verticalCropOffset}px`);
      } else {
        logWithTimestamp(`Slide ${i + 1}: zoomed out, vertical offset = 0px`);
      }
      
      filterComplex += `[${i}:v]fps=${FRAME_RATE},scale=${slideConfig.finalScaleWidth}:${slideConfig.finalScaleHeight},pad=${slideConfig.canvasWidth}:${slideConfig.canvasHeight}:${canvasHorizontalOffset}:${canvasVerticalOffset}:${bgColor},crop=${portraitWidth}:${portraitHeight}:'${panExpression}':${verticalCropOffset},setpts=PTS-STARTPTS[v${i}];`;
    }
  }
  
  // Concatenate all panned frames
  for (let i = 0; i < frameFiles.length; i++) {
    filterComplex += `[v${i}]`;
  }
  filterComplex += `concat=n=${frameFiles.length}:v=1:a=0[outv];[outv]fps=${FRAME_RATE},format=yuv420p[outv2]`;
  
  const cmd = `ffmpeg -y ${inputs}-filter_complex "${filterComplex}" -map "[outv2]" -c:v libx264 -pix_fmt yuv420p "${outputVideo}"`;
  
  await safeExec(cmd, "Creating panning video from still frames");
  
  return outputVideo;
}

// Function to extract and reattach audio
async function reattachAudio(inputVideo, panningVideo, videoInfo) {
  // Extract audio from original video
  const audioFile = path.join(TEMP_DIR, 'audio.aac');
  await safeExec(
    `ffmpeg -y -i "${inputVideo}" -vn -acodec aac "${audioFile}"`,
    "Extracting audio from original video"
  );
  
  const fadeDuration = Math.min(fadeOutDuration, videoInfo.duration);
  const fadeStartTime = Math.max(0, videoInfo.duration - fadeDuration);
  const audioOptions = fadeDuration > 0
    ? `-af "afade=t=out:st=${fadeStartTime}:d=${fadeDuration}" -c:a aac`
    : `-c:a aac`;

  if (fadeDuration > 0) {
    logWithTimestamp(`Audio fade-out: ${fadeDuration}s starting at ${fadeStartTime}s`);
  }
  
  // Combine panning video with audio
  await safeExec(
    `ffmpeg -y -i "${panningVideo}" -i "${audioFile}" -c:v copy ${audioOptions} -shortest "${OUTPUT_FILE}"`,
    "Combining panning video with audio"
  );
  
  return audioFile;
}

// Function to clean up temporary files
async function cleanup(files) {
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        if (fs.statSync(file).isDirectory()) {
          await fs.promises.rm(file, { recursive: true });
        } else {
          await unlink(file);
        }
        logWithTimestamp(`Deleted: ${file}`);
      }
    } catch (error) {
      console.error(`Error deleting ${file}:`, error);
    }
  }
}

// Main processing function
async function processVideo() {
  try {
    logWithTimestamp(`Processing video: ${inputVideo}`);
    
    // Get video information
    const videoInfo = await getVideoInfo(inputVideo);
    logWithTimestamp(`Video dimensions: ${videoInfo.width}x${videoInfo.height}, duration: ${videoInfo.duration}s`);
    
    // Extract still frames and timestamps
    const { stillsDir, frameFiles, usedRegularIntervals, timestamps } = await extractStills(inputVideo);
    
    // If we didn't get timestamps from scene detection, get them using regular intervals
    let finalTimestamps = timestamps;
    if (timestamps.length === 0) {
      finalTimestamps = await getFrameTimestamps(inputVideo, frameFiles.length, usedRegularIntervals);
    }
    logWithTimestamp(`Frame timestamps: ${finalTimestamps.map(t => t.toFixed(2)).join(', ')}`);
    
    // Create panning video
    const panningVideo = await createPanningVideo(stillsDir, frameFiles, finalTimestamps, videoInfo);
    
    // Reattach audio
    const audioFile = await reattachAudio(inputVideo, panningVideo, videoInfo);
    
    // Cleanup
    await cleanup([TEMP_DIR]);
    
    logWithTimestamp("Processing complete.");
    logWithTimestamp(`Output saved as: ${OUTPUT_FILE}`);
    
  } catch (error) {
    console.error("Error during processing:", error);
    // Cleanup on error
    try {
      await cleanup([TEMP_DIR]);
    } catch (cleanupError) {
      console.error("Error during cleanup:", cleanupError);
    }
    process.exit(1);
  }
}

// Run the main function
processVideo();
