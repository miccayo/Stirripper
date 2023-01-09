const bent = require('bent');
const { execFile } = require('child_process');
const getBuffer = bent('buffer');
const fs = require('fs');

if (!process.argv[2]) return console.log('No episode ID was provided. Cannot continue.');
const episodeId = process.argv[2];
const kId = process.argv[3];
const key = process.argv[4];

console.log(`Processing video: kId = ${kId}, key = ${key}.`)

// Prevent from getting by with no key
if (!kId || !key || (!kId && !key)) {
    return console.log('No WideVine key was provided.');
}

(async () => {

    // Create folder for episode
    if (!fs.existsSync(`./${episodeId}`)) {
        fs.mkdirSync(`./${episodeId}`);

        if (!fs.existsSync(`./${episodeId}/video`)) {
            fs.mkdirSync(`./${episodeId}/video`);
        }

        if (!fs.existsSync(`./${episodeId}/audio`)) {
            fs.mkdirSync(`./${episodeId}/audio`);
        }

        if (!fs.existsSync(`./${episodeId}/decrypted`)) {
            fs.mkdirSync(`./${episodeId}/decrypted`);
        }
    }

    // // Best quality I can find provided for Stirr
    const bestAudioQuality = "128kbps_dash";
    const bestVideoQuality = "1080p_dash";

    const initVideoData = await getBuffer(`https://drm-playout.sinclairstoryline.com/${episodeId}/video/${bestVideoQuality}/drm/video/init.mp4`);
    await fs.writeFile(`./${episodeId}/video/init.mp4`, initVideoData, (err) => { if (err) throw err; });

    const initAudioData = await getBuffer(`https://drm-playout.sinclairstoryline.com/${episodeId}/audio/${bestAudioQuality}/drm/audio/init.mp4`);
    await fs.writeFile(`./${episodeId}/audio/init.mp4`, initAudioData, (err) => { if (err) throw err; });

    var hasVideoFinishedDownloading = false;
    var hasAudioFinishedDownloading = false;

    let lastSegment = 0;

    // Download audio at same time as video
    (async () => {
        var audioSegmentId = 0;
        while (hasAudioFinishedDownloading === false) {
            
            try {
                const segmentData = await getBuffer(`https://drm-playout.sinclairstoryline.com/${episodeId}/audio/${bestAudioQuality}/drm/audio/segment_${audioSegmentId}.m4s`);
                await fs.writeFile(`./${episodeId}/audio/segment_${audioSegmentId}.m4s`, segmentData, (err) => { if (err) throw err; });

                console.log(`Downloaded audio segment ${audioSegmentId}`)

                audioSegmentId++;
                // Run until 404/error
            } catch (e) {
                console.log('Reached the last audio segment!');
                console.log(`Segment ID: ${audioSegmentId - 1}.`);
                lastSegment = audioSegmentId - 1;
                hasAudioFinishedDownloading = true;
            }

        }
    })();

    var videoSegmentId = 0;
    while (hasVideoFinishedDownloading === false) {
        
        try {
            const segmentData = await getBuffer(`https://drm-playout.sinclairstoryline.com/${episodeId}/video/${bestVideoQuality}/drm/video/segment_${videoSegmentId}.m4s`);
            await fs.writeFile(`./${episodeId}/video/segment_${videoSegmentId}.m4s`, segmentData, (err) => { if (err) throw err; });

            console.log(`Downloaded video segment ${videoSegmentId}`)

            videoSegmentId++;
            // Run until 404/error
        } catch (e) {
            console.log('Reached the last video segment!');
            // console.log(`Segment ID: ${videoSegmentId - 1}.`)
            lastSegment = videoSegmentId - 1;
            hasVideoFinishedDownloading = true;
        }

    }

    // After this, both mp4s need to be combined
    // touch encrypted_video.mp4; cat init.mp4 > encrypted_video.mp4; cat segment_{0..349}.m4s >>encrypted_video.mp4;
    // To combine: ffmpeg -i video.mp4 -i audio.wav -c:v copy -c:a aac output.mp4
    // mp4decrypt AND ffmpeg.

    // create empty mp4 container for encrypted videos and audio
    var videoFilePath = `./${episodeId}/video/encrypted_video.mp4`;
    var audioFilePath = `./${episodeId}/audio/encrypted_audio.mp4`;

    var basePath = `./${episodeId}`; // touch <x>
    fs.closeSync(fs.openSync(videoFilePath, 'w'), (err) => { throw err; });
    fs.closeSync(fs.openSync(audioFilePath, 'w'), (err) => { throw err; });

    // Do video stuff synchronously
    var videoInit = fs.readFileSync(`${basePath}/video/init.mp4`)
    fs.appendFileSync(videoFilePath, videoInit);
    console.log('Appending video...');

    for (var i = 0; i <= lastSegment; i++) {
        var nextSegment = fs.readFileSync(`${basePath}/video/segment_${i}.m4s`);
        fs.appendFileSync(videoFilePath, nextSegment);
    }

    // Audio too
    var audioInit = fs.readFileSync(`${basePath}/audio/init.mp4`)
    fs.appendFileSync(audioFilePath, audioInit);
    console.log('Appending audio...');

    for (var i = 0; i <= lastSegment; i++) {
        var nextSegment = fs.readFileSync(`${basePath}/audio/segment_${i}.m4s`);
        fs.appendFileSync(audioFilePath, nextSegment);
    }

    // Process separate parts
    console.log(`Processing audio: kId = ${kId}, key = ${key}.`)
    const { spawnSync } = require('child_process');
    var child = spawnSync(`./mp4decrypt.exe`, [
        '--key',
        `${kId}:${key}`,
        `${basePath}/audio/encrypted_audio.mp4`,
        `${basePath}/decrypted/audio.mp4`
    ]);

    console.log(`Processing video: kId = ${kId}, key = ${key}.`)
    var child2 = spawnSync(`./mp4decrypt.exe`, [
        '--key',
        `${kId}:${key}`,
        `${basePath}/video/encrypted_video.mp4`,
        `${basePath}/decrypted/video.mp4`
    ]);

    // merge streams with ffmpeg FFMPEG TIME !!!!
    // To combine: ffmpeg -i video.mp4 -i audio.wav -c:v copy -c:a aac output.mp4
    var child3 = spawnSync(`ffmpeg.exe`, [
        '-i',
        `${basePath}/decrypted/video.mp4`,
        '-i',
        `${basePath}/decrypted/audio.mp4`,
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        `./${basePath}/decrypted/${episodeId}.mp4`
    ]);

    console.log('if not undefined, error2: ', child3.error);
    // console.log('stderr2 ', child3.stderr);

    // var source = fs.createReadStream(`${basePath}/audio/encrypted_audio.mp4`);
    // var dest = fs.createWriteStream(`${basePath}/decrypted/audio.mp4`);

    // source.pipe(dest);
    // source.on('end', function() { /* copied */ });
    // source.on('error', function(err) { /* error */ });

})();
