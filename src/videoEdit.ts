/* eslint-disable no-loop-func */
declare const window: any;
const VideoEdit = (FILE_URL: string, id: string) => {
    const MP4Box = require('mp4box');

    const FPS = 25;
    const ONE_SECOND_IN_MICROSECOND = 1000000; // 秒和微秒转换差
    const BITRATE = 15000000;
    const MICROSECONDS_PER_FRAME = ONE_SECOND_IN_MICROSECOND / FPS;
    const SAMPLE_RATE = 44100;
    let currentTime = 0;
    let PAUSE = false;
    let writer: any;

    // MP4BOX nbSample limits the maximum number of nbSamples
    const nbSampleMax = 10000;
    let file: any = null;
    let videoTrack: any = null;
    let audioTrack: any = null;

    let videoDecoder: any = null;
    const videoFrames: any = [];
    let encodingVideoTrack: any = null;
    let videoFramerate: number = 0;
    let videoW: number;
    let videoH: number;

    let audioDecoder: any = null;
    const decodedAudioFrames: any = [];
    let encodingAudioTrack: any = null;
    let audioTotalTimestamp = 0;

    let videoEncoder: any = null;

    let encodedVideoFrameCount = 0;
    let videoFrameDurationInMicrosecond: number;
    // Changing the output video size
    const encodingVideoScale = 0.5;
    let outputW: number = 0;
    let outputH: number = 0;

    let audioEncoder: any = null;
    let encodedAudioFrameCount = 0;
    let totalaudioEncodeCount = 0;

    const output = document.createElement('canvas');
    output.width = outputW;
    output.height = outputH;
    const ctx = output.getContext('2d');

    document.getElementById(id)?.append(output)
    // document.body.appendChild(output);

    const outputFile = MP4Box.createFile();

    /**
     * 加载媒体文件
     */
    const loadFile = (url: any) => {
        file = MP4Box.createFile();

        file.onerror = (e: any) => {
            console.error('file onerror ', e);
        };

        file.onError = (e: any) => {
            console.error('MP4Box file error => ', e);
        };
        file.onReady = (info: any) => {
            console.log('info------->', info)
            videoTrack = info.videoTracks[0];
            audioTrack = info.audioTracks[0];

            if (audioTrack) {
                audioTotalTimestamp = audioTrack.samples_duration / audioTrack.audio.sample_rate * ONE_SECOND_IN_MICROSECOND;
            }
            const videoDuration = (info.duration / info.timescale) * 1000;

            // 帧速率
            videoFramerate = Math.ceil(1000 / (videoDuration / videoTrack.nb_samples));
            // 帧时长
            videoFrameDurationInMicrosecond = ONE_SECOND_IN_MICROSECOND / videoFramerate;

            videoW = videoTrack.track_width;
            videoH = videoTrack.track_height;

            outputW = videoW * encodingVideoScale;
            outputH = videoH * encodingVideoScale;

            setupVideoDecoder({
                codec: videoTrack.codec,
                codedWidth: videoW,
                codedHeight: videoH,
                description: getExtradata(),
            });

            setupAudioDecoder({
                codec: audioTrack.codec,
                sampleRate: audioTrack.audio.sample_rate,
                numberOfChannels: audioTrack.audio.channel_count,
            });

            file.start();
        };

        file.onSamples = (trackId: any, _ref: any, samples: string | any[]) => {
            if (videoTrack.id === trackId) {                    
                for (const sample of samples) {
                    const type = sample.is_sync ? 'key' : 'delta';

                    const chunk = new window.EncodedVideoChunk({
                        type,
                        timestamp: sample.cts,
                        duration: sample.duration,
                        data: sample.data,
                    });

                    videoDecoder.decode(chunk);
                }

                if (samples.length === videoTrack.nb_samples) {
                    videoDecoder.flush();
                }

                return;
            }

            if (audioTrack.id === trackId) {
                // file.stop();
                console.log(samples)
                for (const sample of samples) {
                    const type = sample.is_sync ? 'key' : 'delta';

                    const chunk = new window.EncodedAudioChunk({
                        type,
                        timestamp: sample.cts,
                        duration: sample.duration,
                        data: sample.data,
                        offset: sample.offset,
                    });

                    audioDecoder.decode(chunk);
                }

                if (samples.length === audioTrack.nb_samples) {
                    audioDecoder.flush();
                }
            }
        };

        fetch(url).then((response) => {
            let offset = 0;
            let buf: any;
            const reader = response.body?.getReader();

            const push = () => reader?.read().then(({ done, value }) => {
                if (done === true) {
                    file.flush(); // will trigle file.onReady
                    return;
                }
                // debugger

                buf = value.buffer;
                buf.fileStart = offset;
                offset += buf.byteLength;
                file.appendBuffer(buf);
                push();
            }).catch((e) => {
                console.error('reader error ', e);
            });
            push();
        });
    };

    /**
     * 编码
     * @param config 
     */
    const setupVideoEncoder = (config: any) => {
        const videoEncodingTrackOptions = {
            timescale: ONE_SECOND_IN_MICROSECOND, // 文件媒体在1秒时间内的刻度，可理解为1s长度的时间单元数
            width: outputW,
            height: outputH,
            nb_samples: videoTrack.nb_samples,
            media_duration: videoTrack.nb_samples * 1000 / FPS,
            brands: ['isom', 'iso2', 'avc1', 'mp41'], // 兼容性的版本
            avcDecoderConfigRecord: null,
        };

        const videoEncodingSampleOptions = {
            duration: videoFrameDurationInMicrosecond,
            dts: 0,
            cts: 0,
            is_sync: false,
        };

        videoEncoder = new window.VideoEncoder({
            output: (encodedChunk: any, config: any) => {
                if (encodingVideoTrack == null) {
                    videoEncodingTrackOptions.avcDecoderConfigRecord = config.decoderConfig.description;
                    encodingVideoTrack = outputFile.addTrack(videoEncodingTrackOptions);
                }

                const buffer = new ArrayBuffer(encodedChunk.byteLength);
                encodedChunk.copyTo(buffer);

                videoEncodingSampleOptions.dts = encodedVideoFrameCount * MICROSECONDS_PER_FRAME;
                videoEncodingSampleOptions.cts = encodedVideoFrameCount * MICROSECONDS_PER_FRAME;
                videoEncodingSampleOptions.is_sync = encodedChunk.type === 'key';

                outputFile.addSample(encodingVideoTrack, buffer, videoEncodingSampleOptions);

                encodedVideoFrameCount++;
                if (encodedVideoFrameCount === videoFrames.length) {
                    onVideoEncodingComplete();
                } else {
                    encodeVideo(encodedVideoFrameCount)
                }
            },
            error: (err: any) => {
                console.error('VideoEncoder error : ', err);
            },

        });

        window.VideoEncoder.isConfigSupported(config).then((support: any) => {
            console.log(`VideoEncoder's config ${JSON.stringify(support.config)} support: ${support.supported}`);
        })
  
        videoEncoder.configure(config);
    };

    let setupAudioEncoder = (config: any) => {
        const audioEncodingTrackOptions = {
            timescale: SAMPLE_RATE,
            media_duration: 0,
            duration: 0,
            nb_samples: 0,
            samplerate: SAMPLE_RATE,
            width: 0,
            height: 0,
            hdlr: 'soun',
            name: 'SoundHandler',
            type: 'Opus',
        };

        const audioEncodingSampleOptions = {
            duration: 0,
            dts: 0,
            cts: 0,
            is_sync: false,
        };

        audioEncoder = new window.AudioEncoder({
            output: (encodedChunk: any, _config: any) => {
                if (encodingAudioTrack === null) {
                    totalaudioEncodeCount = Math.floor(audioTotalTimestamp / encodedChunk.duration);
                    audioEncodingTrackOptions.nb_samples = totalaudioEncodeCount;
                    const trackDuration = audioTotalTimestamp / ONE_SECOND_IN_MICROSECOND;
                    audioEncodingTrackOptions.duration = trackDuration * SAMPLE_RATE;
            
                    audioEncodingTrackOptions.media_duration = trackDuration * SAMPLE_RATE;
            
                    encodingAudioTrack = outputFile.addTrack(audioEncodingTrackOptions);
                }

                const buffer = new ArrayBuffer(encodedChunk.byteLength);
                encodedChunk.copyTo(buffer);
        
                const sampleDuration = encodedChunk.duration / ONE_SECOND_IN_MICROSECOND * SAMPLE_RATE;
        
                audioEncodingSampleOptions.dts = encodedAudioFrameCount * sampleDuration;
                audioEncodingSampleOptions.cts = encodedAudioFrameCount * sampleDuration;
                audioEncodingSampleOptions.duration = sampleDuration;
                audioEncodingSampleOptions.is_sync = encodedChunk.type === 'key';
        
                outputFile.addSample(encodingAudioTrack, buffer, audioEncodingSampleOptions);

                encodedAudioFrameCount++;
                
                if (encodedAudioFrameCount >= totalaudioEncodeCount) {
                    console.log(encodedAudioFrameCount)
                    onAudioEncodingComplete();
                }
            },
            error: (err: any) => {
                console.error('AudioEncoder error : ', err);
            },
        });

        audioEncoder.configure(config);
    };

    const getExtradata = () => {
        // 为VideoDecoder.configure中使用的对象生成属性“description”
        // 此函数由谷歌的Thomas Guilbert编写

        const avccBox = file.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC;

        let i; let size = 7;
        for (i = 0; i < avccBox.SPS.length; i++) size += 2 + avccBox.SPS[i].length;
        for (i = 0; i < avccBox.PPS.length; i++) size += 2 + avccBox.PPS[i].length;

        let id = 0;
        const data = new Uint8Array(size);

        const writeUint8 = (value: any) => {
            data.set([value], id);
            id++;
        };
        const writeUint16 = (value: any) => {
            const arr = new Uint8Array(1);
            arr[0] = value;
            const buffer = new Uint8Array(arr.buffer);
            data.set([buffer[1], buffer[0]], id);
            id += 2;
        };
        const writeUint8Array = (value: any) => {
            data.set(value, id);
            id += value.length;
        };

        writeUint8(avccBox.configurationVersion);
        writeUint8(avccBox.AVCProfileIndication);
        writeUint8(avccBox.profile_compatibility);
        writeUint8(avccBox.AVCLevelIndication);
        writeUint8(avccBox.lengthSizeMinusOne + (63 << 2));
        writeUint8(avccBox.nb_SPS_nalus + (7 << 5));

        for (i = 0; i < avccBox.SPS.length; i++) {
            writeUint16(avccBox.SPS[i].length);
            writeUint8Array(avccBox.SPS[i].nalu);
        }

        writeUint8(avccBox.nb_PPS_nalus);
        for (i = 0; i < avccBox.PPS.length; i++) {
            writeUint16(avccBox.PPS[i].length);
            writeUint8Array(avccBox.PPS[i].nalu);
        }

        if (id !== size) throw new Error('size mismatched !');
        console.log(data)
        return data;
    };

    /**
     * 解码
     * @param config 
     */
    const setupVideoDecoder = (config: any) => {
        output.width = outputW;
        output.height = outputH;

        videoDecoder = new window.VideoDecoder({
            output: (videoFrame: any) => {
                createImageBitmap(videoFrame).then((img) => {
                    videoFrames.push(img);
                    videoFrame.close();

                    if (videoFrames.length === videoTrack.nb_samples) {
                        console.log(videoFrames)
                        setTimeout(() => {
                            drawVideoImage(videoFrames[0]);
                        }, 150);
                    }
                    
                });
            },
            error: (e: any) => {
                console.error('VideoDecoder error : ', e);
            },
        });

        videoDecoder.configure(config);
        file.setExtractionOptions(videoTrack.id, null, { nbSamples: nbSampleMax });
    };

    const setupAudioDecoder = (config: any) => {
        audioDecoder = new window.AudioDecoder({
            output: (audioFrame: any) => {
                decodedAudioFrames.push(audioFrame);
                if (decodedAudioFrames.length === audioTrack.nb_samples) {
                    console.log(decodedAudioFrames)
                }
            },
            error: (err: any) => {
                console.error('AudioDecoder error : ', err);
            },
        });

        audioDecoder.configure(config);

        file.setExtractionOptions(audioTrack.id, null, { nbSamples: nbSampleMax });
        console.log(decodedAudioFrames)
    };

    const getImageBitmap = (url: string) => {
        return new Promise<ImageBitmap>((resolve, reject) => {
            fetch(url).then(response => {
                response.blob().then(blob => {
                    createImageBitmap(blob, 0, 0, videoW, videoH, { resizeWidth: outputW, resizeHeight: outputH, resizeQuality: 'high' }).then(img => {
                        resolve(img)
                    });
                });
            });
        })
    }

    const saveFile = () => {
        if (encodedVideoFrameCount === videoFrames.length && encodedAudioFrameCount === totalaudioEncodeCount) {
            console.log(outputFile.getInfo())
            outputFile.save('test.mp4');
        }
    };

    const onAudioEncodingComplete = () => {
        audioEncoder.close();
        saveFile();
    };

    const onVideoEncodingComplete = () => {
        videoEncoder.close();
        // saveFile();
        encodeAudio();
    };

    const drawVideoImage = (imageBitmap: any) => {
        createImageBitmap(imageBitmap, 0, 0, videoW, videoH, { resizeWidth: outputW, resizeHeight: outputH, resizeQuality: 'high' }).then((bmp) => {
            ctx?.drawImage(bmp, 0, 0);
            bmp.close();
        });
        // imageBitmap.close();
    }

    const playVideo = (start: number = 0) => {
        ctx?.clearRect(0, 0, outputW, outputH)
        console.log(videoFrameDurationInMicrosecond)
        const playLoop = (index: number) => {
            const imageBitmap = videoFrames[index];
            if (index === (videoFrames.length - 1)) {
                currentTime = 0
            }
            if (!imageBitmap) return;
            setTimeout(() => {
                drawVideoImage(imageBitmap)
                if (PAUSE) {
                    currentTime = videoFrameDurationInMicrosecond * index
                } else {
                    playLoop(index + 1)
                }
            }, videoFrameDurationInMicrosecond / 1000 );
        }
        drawVideoImage(videoFrames[start])
        playLoop(start)
    }

    const playAudio = async (start: number = 0) => {
        if (start === 0) {
            const ele = document.getElementsByClassName('audio-play-ele')?.[0];
            if (ele) {
                document.body.removeChild(ele)
            }
            
            const audio = document.createElement('audio');
            audio.style.display = 'none';
            audio.autoplay = true;
            audio.className = 'audio-play-ele'
            document.body.appendChild(audio);
            const generator = new window.MediaStreamTrackGenerator({
                kind: 'audio'
            });
            const {
                writable
            } = generator;
            writer = writable.getWriter();
            const mediaStream = new MediaStream([generator]);
            audio.srcObject = mediaStream;
        }
        // console.log(start)
        for (let index = start; index < decodedAudioFrames.length; index++) {
            const audioFrame = decodedAudioFrames[index].clone();
            const timeout = setTimeout(() => {
                writer.write(audioFrame);
                audioFrame.close()
                clearTimeout(timeout)
            }, audioFrame.timestamp / 1000 );
        }
    }

    const play = () => {
        PAUSE = false
        const videoStart = Math.ceil(currentTime / videoFrameDurationInMicrosecond)
        const audioStart = Math.ceil(currentTime / decodedAudioFrames[0].duration)
        playAudio(audioStart) 
        playVideo(videoStart);
    }
    const pause = () => {
        PAUSE = true;
    }
    const insertImage = async (url: string, starttime: number, duration: number = videoFrameDurationInMicrosecond * 1000) => {
        const imageBitmap = await getImageBitmap(url);
        const count = Math.floor(starttime / videoFrameDurationInMicrosecond * 1000);
        const duracount = Math.floor(duration / videoFrameDurationInMicrosecond * 1000);
        let arr = Array.from({ length:duracount }).map((item,index)=>{
            return imageBitmap;
        });
        videoFrames.splice(count, 0, ...arr);
        play()
    }
    const encodeVideo = (index: number) => {
        const imageBitmap = videoFrames[index]
        const timestamp = videoFrameDurationInMicrosecond * index;
        const videoFrame = new window.VideoFrame(imageBitmap, { timestamp, duration: videoFrameDurationInMicrosecond });
        videoEncoder.encode(videoFrame);
        videoFrame.close();
    }
    const encodeAudio = () => {
        for (let index = 0; index < decodedAudioFrames.length; index++) {
            const audioFrame = decodedAudioFrames[index].clone();
            audioEncoder.encode(audioFrame);
            audioFrame.close()
        }
    }
    const exportVideo = () => {
        setupVideoEncoder({
            codec: 'avc1.42001E',
            width: outputW,
            height: outputH,
            hardwareAcceleration: 'prefer-software',
            framerate: videoFramerate,
            bitrate: BITRATE,
            // avc: { format: 'avc' },
        });
        setupAudioEncoder({
            // codec: audioTrack.codec, // AudioEncoder does not support this field
            codec: 'opus',
            sampleRate: audioTrack.audio.sample_rate,
            numberOfChannels: audioTrack.audio.channel_count,
            bitrate: audioTrack.bitrate,
        });
        encodedVideoFrameCount = 0;
        encodedAudioFrameCount = 0;
        encodeVideo(encodedVideoFrameCount);
    }

    const init = () => {
        loadFile(FILE_URL);
    }

    return {
        init,
        play,
        pause,
        insertImage,
        exportVideo
    }
}

export default VideoEdit