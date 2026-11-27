import {extractItemCode} from './ocr-code.js';

export function createCamera({video, motionCanvas, ocrCanvas, status, accept, onError, onMode, extract = extractItemCode, assetBase, loadAssets}) {
  let stream, worker, loading, motionTimer, soundContext;
  let generation = 0, scanning = false, paused = false, ocrBusy = false;
  let lastMotion, stableSince = 0, motionVersion = 0, armed = true;

  function resetDetection() {
    lastMotion = null;
    stableSince = 0;
    motionVersion++;
  }

  function stop() {
    generation++;
    scanning = paused = false;
    clearInterval(motionTimer);
    resetDetection();
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    onMode('off');
  }

  async function getWorker() {
    if (worker) return worker;
    if (!loading) {
      const base = assetBase;
      loading = (async () => {
        let timer;
        let created;
        let expired = false;
        const init = async () => {
          if (!window.Tesseract) throw new Error('OCRライブラリが見つかりません');
          const assets = loadAssets ? await loadAssets() : null;
          if (expired) return;
          created = await window.Tesseract.createWorker('eng', 1, {
            ...(assets ? {workerPath:assets.workerPath, corePath:assets.corePath, langPath:assets.langPath, workerBlobURL:false}
              : {workerPath:base+'worker.min.js', corePath:base, langPath:base, workerBlobURL:false}),
            cacheMethod:'none',
          });
          if (expired) {
            await created.terminate();
            return;
          }
          await created.setParameters({
            tessedit_char_whitelist:'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
            preserve_interword_spaces:'1', tessedit_pageseg_mode:'6',
          });
          return created;
        };
        try {
          worker = await Promise.race([init(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('OCRの読み込みがタイムアウトしました')), 20000);
          })]);
          return worker;
        } catch (error) {
          expired = true;
          if (created) await created.terminate();
          throw error;
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    try {
      return await loading;
    } finally {
      loading = null;
    }
  }

  async function start() {
    const session = ++generation;
    onMode('loading');
    status('カメラを起動しています…');
    try {
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (policy?.allowsFeature('camera') === false) {
        throw new Error('このページの権限ポリシーがカメラを制限しています。OCRはダミー画像で確認できます');
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('このブラウザではカメラを使用できません');
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (Audio) {
          soundContext = soundContext || new Audio();
          soundContext.resume().catch(() => {});
        }
      } catch {}
      const opened = await navigator.mediaDevices.getUserMedia({
        audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}},
      });
      if (session !== generation) {
        opened.getTracks().forEach(track => track.stop());
        return;
      }
      stream = opened;
      video.srcObject = stream;
      await video.play();
      if (session !== generation) return;
      status('OCRを準備しています…');
      await getWorker();
      if (session !== generation) return;
      scanning = armed = true;
      paused = false;
      resetDetection();
      onMode('running');
      status('枠内に品番を合わせ、約0.3秒静止してください');
      motionTimer = setInterval(checkMotion, 180);
    } catch (error) {
      if (session !== generation) return;
      stop();
      onError('カメラ起動エラー：' + error.message);
    }
  }

  function pause() {
    if (!scanning) return;
    paused = !paused;
    resetDetection();
    armed = false;
    onMode(paused ? 'paused' : 'running');
    status(paused ? 'OCR一時停止中' : 'カメラを動かして次のタグへ');
  }

  function rearm() {
    resetDetection();
    if (!scanning) return;
    armed = true;
    paused = false;
    onMode('running');
    status('再スキャン待機中');
  }

  function beep(){try{if(!soundContext)soundContext=new (window.AudioContext||window.webkitAudioContext)();soundContext.resume();const osc=soundContext.createOscillator(),gain=soundContext.createGain();osc.type='sine';osc.frequency.value=960;gain.gain.setValueAtTime(.12,soundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+.12);osc.connect(gain);gain.connect(soundContext.destination);osc.start();osc.stop(soundContext.currentTime+.13);}catch(e){}if(navigator.vibrate)navigator.vibrate(80);}
  function checkMotion(){
    if(!scanning||paused||video.readyState<2)return;
    const w=64,h=48;motionCanvas.width=w;motionCanvas.height=h;const ctx=motionCanvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(video,0,0,w,h);const rgba=ctx.getImageData(0,0,w,h).data;const now=new Uint8Array(w*h);
    for(let i=0;i<now.length;i++)now[i]=(rgba[i*4]*3+rgba[i*4+1]*6+rgba[i*4+2])/10;
    let diff=0;if(lastMotion){for(let i=0;i<now.length;i+=3)diff+=Math.abs(now[i]-lastMotion[i]);diff/=Math.ceil(now.length/3);}lastMotion=now;
    const moving=diff>16; // 手ぶれ・照明変動を含むため実機で調整する閾値
    if(moving){stableSince=0;motionVersion++;if(!armed){armed=true;status('次の品番を読み取り待機中');}return;}
    if(!armed)return;
    if(!stableSince){stableSince=Date.now();return;}
    if(Date.now()-stableSince>=300&&!ocrBusy)recognizeFrame();
  }
  function captureCrop(widthRatio,heightRatio){
    return new Promise((resolve,reject)=>{
      const iw=video.videoWidth,ih=video.videoHeight;if(!iw||!ih){reject(new Error('カメラ映像がありません'));return;}
      const cropW=iw*widthRatio,cropH=ih*heightRatio,cropX=(iw-cropW)/2,cropY=(ih-cropH)/2;
      const TARGET_WIDTH=1800,scale=TARGET_WIDTH/cropW; // 元の画像サイズ（1800px）に戻す
      ocrCanvas.width=TARGET_WIDTH;ocrCanvas.height=Math.round(cropH*scale);
      const ctx=ocrCanvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(video,cropX,cropY,cropW,cropH,0,0,ocrCanvas.width,ocrCanvas.height);
      ocrCanvas.toBlob(blob=>blob?resolve(blob):reject(new Error('OCR画像生成失敗')),'image/jpeg',.90);
    });
  }

  async function recognizeFrame() {
    if (ocrBusy || !scanning || paused || !armed) return;
    ocrBusy = true;
    const version = motionVersion;
    const current = () => scanning && !paused && version === motionVersion && armed;
    try {
      status('品番を認識中…');
      const tight = await captureCrop(.60, .36);
      const r1 = await worker.recognize(tight);
      if (!current()) return;
      let code = extract(r1.data.text || '');
      if (!code) {
        const wide = await captureCrop(.78, .58);
        const r2 = await worker.recognize(wide);
        code = extract((r1.data.text || '') + '\n' + (r2.data.text || ''));
      }
      if (!current()) return;
      if (!code) {
        status('認識待機中：品番を枠内で静止');
        return;
      }
      armed = false;
      if (accept(code)) {
        status('読み取り成功：' + code + '。次のタグへ移動してください');
        beep();
      }
    } catch (error) {
      if (current()) {
        armed = false;
        onError('OCRエラー：' + error.message);
      }
    } finally {
      ocrBusy = false;
    }
  }

  async function recognizeTestImage(image) {
    const engine = await getWorker();
    return (await engine.recognize(image)).data.text;
  }

  return {start, stop, pause, rearm, recognizeTestImage};
}
