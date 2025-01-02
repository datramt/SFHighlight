# scorefol.io Ending Sequence Concatenation
Concatenates ending sequence to scorefol.io videos

To Use:
`node concat.js ~/path/to/file.mp4 F` (for FMS ending)
`node concat.js ~/path/to/file.mp4 H` (for scorefol.io Highlight ending)

- Determines which sequence to use based on argument.
- Upscales FPS of score video to 30fps so that ending sequence animation doesn't display poorly.
- Ensures audio of ending sequence is in sync with video in cases where the score video has silent preliminary pages displayed at end.
- Concatenates the score video with the ending sequence.
- Detects if output was 4k or not, and chooses appropriate output accordingly.

NEW FEATURES (helpers to share on social media)
`node gifmaker.js ~/path/to/file.mp4 10 GIF` will generate a GIF containing each still frame of the score video at 10 frames per second
`node extractStills.js ~/path/to/file.mp4` will likewise extract stills from the score video, but will drop them as individual images in a folder called _stills

Warning regarding stills extractors: Currently, the system assumes you are strictly working with non-animated videos. extractStills.js has a bit of protection if you accidentally selected a video that has animation, but you generally do not want to run this if there is frame-by-frame animated motion, as it will significantly increase the size of the output.