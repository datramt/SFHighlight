const { exec } = require("child_process");
const util = require("util");

// Promisify exec function
const execPromise = util.promisify(exec);

// Input arguments
const inputVideo = process.argv[2];
const fadeDuration = process.argv[3]; // Duration in seconds

// Validate input arguments
if (!inputVideo || !fadeDuration) {
  console.error("Usage: node fadeout.js <inputVideo> <fadeDurationInSeconds>");
  process.exit(1);
}

// Validate fade duration is a positive number
if (isNaN(fadeDuration) || parseFloat(fadeDuration) <= 0) {
  console.error("Error: fadeDuration must be a positive number");
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

// Function to get video duration
async function getVideoDuration(video) {
  const { stdout } = await execPromise(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${video}"`
  );
  return parseFloat(stdout.trim());
}

// Function to add fade-out effect
async function addFadeOut(inputVideo, fadeDuration) {
  const duration = await getVideoDuration(inputVideo);
  const fadeStartTime = duration - parseFloat(fadeDuration);
  
  // Always use 'faded.mp4' as output filename
  const outputVideo = "_faded.mp4";
  
  logWithTimestamp(`Video duration: ${duration}s, Audio fade start time: ${fadeStartTime}s`);
  
  const cmd = `ffmpeg -y -i "${inputVideo}" -af "afade=t=out:st=${fadeStartTime}:d=${fadeDuration}" -c:v copy "${outputVideo}"`;
  
  await safeExec(cmd, `Adding ${fadeDuration}-second audio fade-out to video`);
  
  logWithTimestamp(`Audio fade-out video saved as: ${outputVideo}`);
}

// Main processing function
async function processVideo() {
  try {
    logWithTimestamp(`Processing video: ${inputVideo}`);
    logWithTimestamp(`Fade duration: ${fadeDuration} seconds`);
    
    await addFadeOut(inputVideo, fadeDuration);
    
    logWithTimestamp("Fade-out processing complete.");
  } catch (error) {
    console.error("Error during processing:", error);
    process.exit(1);
  }
}

// Run the main function
processVideo();
