const { exec, spawn } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);

// Input arguments
const inputVideo = process.argv[2];

// Validate input arguments
if (!inputVideo) {
  console.error("Usage: node shortify.js <inputVideo>");
  process.exit(1);
}

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
  const scaleFactor = portraitHeight / landscapeHeight;
  const scaledWidth = Math.round(landscapeWidth * scaleFactor);
  
  // Pan distance (how much we need to pan from left to right)
  const panDistance = scaledWidth - portraitWidth;
  
  logWithTimestamp(`Panning parameters: input=${landscapeWidth}x${landscapeHeight}, output=${portraitWidth}x${portraitHeight}, scale=${scaleFactor.toFixed(3)}, pan distance=${panDistance.toFixed(0)}px`);
  
  // Create filter complex for each frame with panning
  let filterComplex = '';
  let inputs = '';
  
  for (let i = 0; i < frameFiles.length; i++) {
    const frameFile = path.join(stillsDir, frameFiles[i]);
    // Calculate duration for this frame segment
    let duration;
    if (i < timestamps.length - 1) {
      duration = timestamps[i + 1] - timestamps[i];
    } else {
      // For the last frame, use the remaining time to match total video duration
      duration = videoInfo.duration - timestamps[i];
    }
    
    inputs += `-loop 1 -t ${duration} -i "${frameFile}" `;
    
    // Create panning filter for this frame; force 60fps BEFORE crop so pan updates 60x/sec
    filterComplex += `[${i}:v]fps=${FRAME_RATE},scale=${scaledWidth}:${portraitHeight},crop=${portraitWidth}:${portraitHeight}:'${panDistance}*t/${duration}':0,setpts=PTS-STARTPTS[v${i}];`;
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
async function reattachAudio(inputVideo, panningVideo) {
  // Extract audio from original video
  const audioFile = path.join(TEMP_DIR, 'audio.aac');
  await safeExec(
    `ffmpeg -y -i "${inputVideo}" -vn -acodec aac "${audioFile}"`,
    "Extracting audio from original video"
  );
  
  // Combine panning video with audio
  await safeExec(
    `ffmpeg -y -i "${panningVideo}" -i "${audioFile}" -c:v copy -c:a aac -shortest "${OUTPUT_FILE}"`,
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
    const audioFile = await reattachAudio(inputVideo, panningVideo);
    
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
