const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");

const execPromise = util.promisify(exec);
const inputVideo = process.argv[2];

// Validate input
if (!inputVideo) {
    console.error("Usage: node extractStills.js <video>");
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

async function extractStills(inputVideo) {
    const outputDir = '_stills';
    
    try {
        // Delete existing _stills directory if it exists
        if (fs.existsSync(outputDir)) {
            logWithTimestamp("Removing existing _stills directory");
            await fs.promises.rm(outputDir, { recursive: true, force: true });
        }

        // Create fresh output directory
        logWithTimestamp("Creating new _stills directory");
        await fs.promises.mkdir(outputDir, { recursive: true });

        // Extract unique frames using scene detection
        await safeExec(
            `ffmpeg -i "${inputVideo}" -vf "select='if(eq(n,0),1,gt(scene,0.15))'" -vsync vfr "${outputDir}/_stills_%d.png"`,
            `Extracting unique frames from ${inputVideo}`
        );

        logWithTimestamp("Successfully extracted still frames");

    } catch (error) {
        console.error("Error processing video:", error);
        process.exit(1);
    }
}

// Main processing function
async function processVideo() {
    logWithTimestamp(`Processing video: ${inputVideo}`);
    await extractStills(inputVideo);
    logWithTimestamp(`Finished processing: ${inputVideo}`);
    logWithTimestamp("Frames saved in _stills directory");
}

// Run the main function
processVideo();
