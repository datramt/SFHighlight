const { exec } = require("child_process");
const fs = require("fs");
const util = require("util");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);

// Constants for file paths
const OUTPUT_4K_FMS = "outros/fms_outro_30fps_44100ar_4k.mp4";
const OUTPUT_1080P_FMS = "outros/fms_outro_30fps_44100ar.mp4";
const OUTPUT_4K_SCORE = "outros/scorefol.io_outro_30fps_44100ar_4k.mp4";
const OUTPUT_1080P_SCORE = "outros/scorefol.io_outro_30fps_44100ar.mp4";
const OUTPUT_4K_SITES = "outros/sites_outro_30fps_44100ar_4k.mp4";
const OUTPUT_1080P_SITES = "outros/sites_outro_30fps_44100ar.mp4";
const TEMP_VIDEO = "inputsf_30fps.mp4";
const TEMP_VIDEO_WITH_SILENCE = "inputsf_30fps_with_silence.mp4";
const VID_LIST_FILE = "vidList.txt";

// Input arguments
const inputVideo = process.argv[2];
const videoType = process.argv[3]; // 'F' for FMS, 'H' for Highlight, 'S' for Sites

// Validate input arguments
if (!inputVideo || !videoType || !["F", "H", "S"].includes(videoType)) {
  console.error("Usage: node script.js <inputVideo> <videoType ('F', 'H', or 'S')>");
  process.exit(1);
}

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

// Function to get video width
async function getVideoWidth(video) {
  const { stdout } = await execPromise(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=s=x:p=0 ${video}`
  );
  return stdout.trim();
}

// Function to get the correct outro file based on resolution and video type
function getOutroFile(resWidth, videoType) {
  const is4k = resWidth === "3840";
  const files = {
    F: is4k ? OUTPUT_4K_FMS : OUTPUT_1080P_FMS,
    H: is4k ? OUTPUT_4K_SCORE : OUTPUT_1080P_SCORE,
    S: is4k ? OUTPUT_4K_SITES : OUTPUT_1080P_SITES
  };
  
  const selectedFile = files[videoType];
  
  // Check if outro file exists
  if (videoType === 'S' && !fs.existsSync(selectedFile)) {
    console.error(`\nError: Sites outro file not found: ${selectedFile}`);
    console.error("Please run makeOutros.js first to generate the outro files.\n");
    process.exit(1);
  }
  
  return selectedFile;
}

// Function to increase framerate to 30 fps
async function increaseFramerate(input) {
  await safeExec(
    `ffmpeg -y -i ${input} -r 30 -vcodec libx264 -acodec aac ${TEMP_VIDEO}`,
    "Increasing video framerate to 30 fps"
  );
}

// Function to add silence to match video duration
async function addSilenceToMatchDuration() {
  const cmd = `
    VIDEO_DURATION=$(ffprobe -v error -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 -select_streams v:0 ${TEMP_VIDEO}) &&
    AUDIO_DURATION=$(ffprobe -v error -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 -select_streams a:0 ${TEMP_VIDEO}) &&
    DIFFERENCE=$(echo "$VIDEO_DURATION - $AUDIO_DURATION" | bc) &&
    ffmpeg -y -i ${TEMP_VIDEO} -filter_complex "[0:a]apad=whole_len=$(echo "($VIDEO_DURATION*44100)/1" | bc)[aout]" -map 0:v -map "[aout]" -vcodec copy -acodec aac ${TEMP_VIDEO_WITH_SILENCE}
  `;
  await safeExec(cmd, "Adding silence to match video duration");
}

// Function to generate vidList.txt dynamically
async function generateVidList(outroFile) {
  const vidListContent = `file '${TEMP_VIDEO_WITH_SILENCE}'\nfile '${outroFile}'`;
  logWithTimestamp("Generating vidList.txt dynamically...");
  logWithTimestamp(`vidList.txt content:\n${vidListContent}`);
  await writeFile(VID_LIST_FILE, vidListContent);
}

// Function to concatenate the video with outro
async function concatenateVideo(videoType) {
  const outputFileNames = {
    F: "_fms.mp4",
    H: "_scorefolioHighlight.mp4",
    S: "_sites.mp4"
  };
  const outputFileName = outputFileNames[videoType];
  await safeExec(
    `ffmpeg -y -f concat -safe 0 -i ${VID_LIST_FILE} -c copy ${outputFileName}`,
    "Concatenating video with outro"
  );
}

// Function to clean up temporary files
async function cleanup(files) {
  for (const file of files) {
    try {
      await unlink(file);
      logWithTimestamp(`Deleted temporary file: ${file}`);
    } catch (error) {
      console.error(`Error deleting file: ${file}`, error);
    }
  }
}

// Main processing function
async function processVideo() {
  try {
    const resWidth = await getVideoWidth(inputVideo);
    logWithTimestamp(`Width Resolution: ${resWidth}`);

    const outroFile = getOutroFile(resWidth, videoType);

    if (resWidth === "3840") {
      logWithTimestamp("Using 4k ending sequence...");
    } else {
      logWithTimestamp("Using 1080p ending sequence...");
    }

    await increaseFramerate(inputVideo);
    await addSilenceToMatchDuration();
    await generateVidList(outroFile);
    await concatenateVideo(videoType);
    await cleanup([TEMP_VIDEO, TEMP_VIDEO_WITH_SILENCE, VID_LIST_FILE]);

    logWithTimestamp("Processing complete.");
  } catch (error) {
    console.error("Error during processing:", error);
  }
}

// Run the main function
processVideo();
