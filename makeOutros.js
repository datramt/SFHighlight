const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

// Promisify exec
const execPromise = util.promisify(exec);

// Get input video from command line arguments
const inputVideo = process.argv[2];

// Validate input
if (!inputVideo) {
    console.error("Usage: node makeOutros.js <input_video>");
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

async function createOutros() {
    try {
        // Create 1080p version
        const command1080p = `ffmpeg -i "${inputVideo}" `
            + `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" `
            + `-r 30 -ar 44100 `
            + `-c:v libx264 -preset medium -crf 23 `
            + `-c:a aac -b:a 192k `
            + `-pix_fmt yuv420p `
            + `-y "outros/sites_outro_30fps_44100ar.mp4"`;

        // Create 4K version
        const command4k = `ffmpeg -i "${inputVideo}" `
            + `-vf "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2" `
            + `-r 30 -ar 44100 `
            + `-c:v libx264 -preset medium -crf 23 `
            + `-c:a aac -b:a 192k `
            + `-pix_fmt yuv420p `
            + `-y "outros/sites_outro_30fps_44100ar_4k.mp4"`;

        await safeExec(command1080p, "Creating 1080p version");
        await safeExec(command4k, "Creating 4K version");

        logWithTimestamp("Both versions created successfully!");

    } catch (error) {
        console.error("Error during processing:", error);
        process.exit(1);
    }
}

// Run the main function
createOutros(); 