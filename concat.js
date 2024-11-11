const { exec } = require("child_process");
const fs = require("fs");

const inputVideo = process.argv[2];
const videoType = process.argv[3]; // 'F' for FMS, 'H' for Highlight
let resWidth;
let vidList;
let outroFile;

// Get width of video and log it
exec(
  `ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=s=x:p=0 ${inputVideo}`,
  (err, stdout) => {
    if (err) return console.error(err);

    if (videoType === "F") {
      console.log("Processing FMS video...");
    } else {
      console.log("Processing Highlight video...");
    }

    resWidth = stdout.trim();
    console.log(`Width Resolution: ${resWidth}`);

    // Determine which outro sequence to use based on resolution and video type
    if (resWidth === "3840") {
      vidList = videoType === "F" ? "vidListFms4k.txt" : "vidListSh4k.txt";
      outroFile =
        videoType === "F"
          ? "outros/fms_outro_30fps_44100ar_4k.mp4"
          : "outros/scorefol.io_outro_30fps_44100ar_4k.mp4";
      console.log("Using 4k ending sequence...");
    } else {
      vidList = videoType === "F" ? "vidListFms.txt" : "vidListSh.txt";
      outroFile =
        videoType === "F"
          ? "outros/fms_outro_30fps_44100ar.mp4"
          : "outros/scorefol.io_outro_30fps_44100ar.mp4";
      console.log("Using 1080p ending sequence...");
    }

    console.log("Increasing score video framerate to 30 fps...");
    exec(
      `ffmpeg -y -i ${inputVideo} -r 30 -vcodec libx264 -acodec aac inputsf_30fps.mp4`,
      (err) => {
        if (err) return console.error(err);

        console.log("Probing duration of video stream & audio stream to determine how many seconds the ending sequence is");
        console.log("Adding silence to end of audio stream so that both streams match in duration");
        exec(
          `VIDEO_DURATION=$(ffprobe -v error -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 -select_streams v:0 inputsf_30fps.mp4) && AUDIO_DURATION=$(ffprobe -v error -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 -select_streams a:0 inputsf_30fps.mp4) && DIFFERENCE=$(echo "$VIDEO_DURATION - $AUDIO_DURATION" | bc) && ffmpeg -y -i inputsf_30fps.mp4 -filter_complex "[0:a]apad=whole_len=$(echo "($VIDEO_DURATION*44100)/1" | bc)[aout]" -map 0:v -map "[aout]" -vcodec copy -acodec aac inputsf_30fps_with_silence.mp4`,
          (err) => {
            if (err) return console.error(err);

            console.log("Generating vidList.txt dynamically...");
            const vidListContent = `file 'inputsf_30fps_with_silence.mp4'\nfile '${outroFile}'`;

            fs.writeFileSync("vidList.txt", vidListContent);

            console.log("Concatenating score video with outro...");
            exec(
              `ffmpeg -y -f concat -safe 0 -i vidList.txt -c copy ${
                videoType === "F" ? "_fms.mp4" : "_scorefolioHighlight.mp4"
              }`,
              (err) => {
                if (err) return console.error(err);
                console.log("Processing complete.");

                // Delete the temporary files
                fs.unlink("inputsf_30fps.mp4", (err) => {
                  if (err) console.error(err);
                });
                fs.unlink("inputsf_30fps_with_silence.mp4", (err) => {
                  if (err) console.error(err);
                });
                fs.unlink("vidList.txt", (err) => {
                  if (err) console.error(err);
                });
              }
            );
          }
        );
      }
    );
  }
);
