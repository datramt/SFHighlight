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
const OUTPUT_FILE = "shorted.mp4";
const FRAME_RATE = 30;

// Helper function for logging with timestamps
function logWithTimestamp(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
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

// Function to extract still frames using scene detection
async function extractStills(inputVideo) {
  const stillsDir = path.join(TEMP_DIR, 'stills');
  
  // Create temporary directory
  await fs.promises.mkdir(stillsDir, { recursive: true });
  
  // Extract unique frames using scene detection (similar to extractStills.js)
  await safeExec(
    `ffmpeg -i "${inputVideo}" -vf "select='if(eq(n,0),1,gt(scene,0.15))'" -vsync vfr "${stillsDir}/frame_%d.png"`,
    "Extracting still frames from video"
  );
  
  // Get list of extracted frames
  const files = await fs.promises.readdir(stillsDir);
  const frameFiles = files
    .filter(file => file.startsWith('frame_') && file.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/frame_(\d+)\.png/)[1]);
      const numB = parseInt(b.match(/frame_(\d+)\.png/)[1]);
      return numA - numB;
    });
  
  logWithTimestamp(`Extracted ${frameFiles.length} still frames`);
  return { stillsDir, frameFiles };
}

// Function to get frame timestamps from original video
async function getFrameTimestamps(inputVideo, frameCount) {
  // Use a simpler approach - just estimate timestamps based on frame count and duration
  const videoInfo = await getVideoInfo(inputVideo);
  const timestamps = [];
  
  // For now, just create evenly spaced timestamps
  // In a real implementation, you'd want to use the actual scene detection timestamps
  for (let i = 0; i < frameCount; i++) {
    timestamps.push((videoInfo.duration / frameCount) * i);
  }
  
  return timestamps;
}

// Function to create panning video from still frames
async function createPanningVideo(stillsDir, frameFiles, timestamps, videoInfo) {
  const outputVideo = path.join(TEMP_DIR, 'panning_video.mp4');
  
  // Calculate panning parameters
  const landscapeWidth = videoInfo.width;
  const landscapeHeight = videoInfo.height;
  const portraitHeight = 1080; // Standard portrait height
  const portraitWidth = 608;   // Standard portrait width (9:16 aspect ratio)
  
  // Scale factor to fit landscape height to portrait height
  const scaleFactor = portraitHeight / landscapeHeight;
  const scaledWidth = landscapeWidth * scaleFactor;
  
  // Pan distance (how much we need to pan from left to right)
  const panDistance = scaledWidth - portraitWidth;
  
  logWithTimestamp(`Panning parameters: scale=${scaleFactor.toFixed(3)}, pan distance=${panDistance.toFixed(0)}px`);
  
  // Create filter complex for each frame with panning
  let filterComplex = '';
  let inputs = '';
  
  for (let i = 0; i < frameFiles.length; i++) {
    const frameFile = path.join(stillsDir, frameFiles[i]);
    const duration = i < timestamps.length - 1 ? timestamps[i + 1] - timestamps[i] : 2.0; // Default 2s for last frame
    
    inputs += `-loop 1 -t ${duration} -i "${frameFile}" `;
    
    // Create panning filter for this frame
    filterComplex += `[${i}:v]scale=${scaledWidth}:${portraitHeight},crop=${portraitWidth}:${portraitHeight}:'if(gte(t,0),${panDistance}*(t/${duration}),0)':0[v${i}];`;
  }
  
  // Concatenate all panned frames
  for (let i = 0; i < frameFiles.length; i++) {
    filterComplex += `[v${i}]`;
  }
  filterComplex += `concat=n=${frameFiles.length}:v=1:a=0[outv]`;
  
  const cmd = `ffmpeg -y ${inputs}-filter_complex "${filterComplex}" -map "[outv]" -c:v libx264 -r ${FRAME_RATE} -pix_fmt yuv420p "${outputVideo}"`;
  
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
    
    // Extract still frames
    const { stillsDir, frameFiles } = await extractStills(inputVideo);
    
    // Get frame timestamps
    const timestamps = await getFrameTimestamps(inputVideo, frameFiles.length);
    logWithTimestamp(`Frame timestamps: ${timestamps.map(t => t.toFixed(2)).join(', ')}`);
    
    // Create panning video
    const panningVideo = await createPanningVideo(stillsDir, frameFiles, timestamps, videoInfo);
    
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
