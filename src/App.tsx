import React, { useEffect, useState } from 'react';
import './App.css';
import VideoEdit from './videoEdit';

// const FILE_URL = './video.mp4';
const FILE_URL = './1280-720-33s.mp4'
// const FILE_URL = 'http://distribution.bbb3d.renderfarming.net/video/mp4/bbb_sunflower_1080p_60fps_normal.mp4'

function App() {
  const [videoEdit, setVideoEdit] = useState<any>()
  useEffect(() => {
    const videoEdit = VideoEdit(FILE_URL, 'video-canvas')
    setVideoEdit(videoEdit)
    videoEdit.init()
  }, [])

  const handlePlay = () => {
    videoEdit.play()
  }

  const handleInsert = () => {
    videoEdit.insertImage('./head.jpg', 30000, 2000)
  }

  const handleExport = () => {
    videoEdit.exportVideo()
  }

  return (
    <div className="video_track">
      {/* <video controls src={FILE_URL}></video> */}
      <div id="video-canvas"></div>
      <button onClick={handlePlay}>播放</button>
      {/* <button onClick={handlePause}>暂停</button> */}
      <button onClick={handleInsert}>插入图片</button>
      <button onClick={handleExport}>导出视频</button>
    </div>
  );
}

export default App;
