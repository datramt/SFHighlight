const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec and fs functions
const execPromise = util.promisify(exec);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);

// Get input arguments
const inputVideo = process.argv[2];
const frameRate = process.argv[3] || 2;  // default to 2fps (0.5s per frame)
const outputFormat = (process.argv[4] || 'GIF').toUpperCase();

// Validate input
if (!inputVideo) {
    console.error("Usage: node gifmaker.js <video> [framerate=2] [format=GIF]");
    console.error("Format can be 'GIF' or 'MP4'");
    process.exit(1);
}

if (!['GIF', 'MP4'].includes(outputFormat)) {
    console.error("Format must be either 'GIF' or 'MP4'");
    process.exit(1);
}

// Helper function for logging with timestamps
function logWithTimestamp(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

// Helper function for executing commands
async function safeExec(command, stepDescription) {
    try {
        logWithTimestamp(`Starting: ${stepDescription}`);
        const { stdout, stderr } = await execPromise(command);
        logWithTimestamp(`Completed: ${stepDescription}`);
        return stdout;
    } catch (error) {
        console.error(`Failed during: ${stepDescription}\nCommand: ${command}\nError: ${error.message}`);
        process.exit(1);
    }
}

// Function to extract unique frames from a video
async function extractUniqueFrames(inputVideo) {
    const tempDir = `temp_frames_${Date.now()}`;
    const outputFile = outputFormat === 'GIF' ? './_gif.gif' : './_gif.mp4';
    
    try {
        // Create temporary directory
        await fs.promises.mkdir(tempDir, { recursive: true });

        // Modified scene detection to force include first frame and be more sensitive
        await safeExec(
            `ffmpeg -i "${inputVideo}" -vf "select='if(eq(n,0),1,gt(scene,0.08))'" -vsync vfr "${tempDir}/frame_%d.png"`,
            `Extracting unique frames from ${inputVideo}`
        );

        // Create output file based on format with numerical sorting
        if (outputFormat === 'GIF') {
            await safeExec(
                `ffmpeg -y -framerate ${frameRate} -i "${tempDir}/frame_%d.png" -vf "scale=1920:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${outputFile}"`,
                "Creating GIF from frames"
            );
        } else {
            await safeExec(
                `ffmpeg -y -framerate ${frameRate} -i "${tempDir}/frame_%d.png" -c:v libx264 -pix_fmt yuv420p -vf "scale=1920:-1:flags=lanczos" "${outputFile}"`,
                "Creating MP4 from frames"
            );
        }

        // Cleanup
        await fs.promises.rm(tempDir, { recursive: true });
        logWithTimestamp(`Cleaned up temporary directory: ${tempDir}`);

    } catch (error) {
        console.error("Error processing video:", error);
        try {
            await fs.promises.rm(tempDir, { recursive: true });
        } catch (cleanupError) {
            console.error("Error during cleanup:", cleanupError);
        }
    }
}

// Simplify main function since we're only processing one video
async function processVideo() {
    logWithTimestamp(`Processing video: ${inputVideo}`);
    await extractUniqueFrames(inputVideo);
    logWithTimestamp(`Finished processing: ${inputVideo}`);
    logWithTimestamp(`Output saved as: ${outputFormat === 'GIF' ? '_gif.gif' : '_gif.mp4'}`);
}

// Run the main function
processVideo();
